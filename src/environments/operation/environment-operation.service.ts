import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';

// Antrean lingkungan, model tarik: konsol meminta, worker operations-metta di host runtime mengambil (claim) satu per
// satu dengan tenggat, melaporkan langkahnya, lalu menutupnya. Setiap langkah dan penutupan mensyaratkan operasi masih
// dipegang host itu dan tenggatnya belum lewat, jadi worker yang tenggatnya sudah habis tidak bisa lagi mengaktifkan
// lingkungan (di CoreERP penutupan sukses tidak memeriksa ini). Tidak ada penjadwal: tenggat yang lewat ditutup saat
// antrean dibaca.
export const leaseMinutes = 30;

export const environmentOperations = ['provision', 'migrate'] as const;
export type EnvironmentOperation = (typeof environmentOperations)[number];

const now = "now() at time zone 'utc'";
const iso = (column: string) =>
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"')`;
// Setiap penutupan membuang hash password admin pertama dari parameternya.
const closing = (status: 'succeeded' | 'failed') =>
    `status = '${status}', finished_at = ${now}, lease_until = null,
     parameters = parameters #- '{admin,password_hash}'`;

const claimedSchema = z.object({
    id: z.string(),
    operation: z.string(),
    environment_id: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    lease_until: z.string(),
});
export type ClaimedOperation = z.infer<typeof claimedSchema>;

async function expireStale(db: Database): Promise<void> {
    await db.execute(
        `with expired as (
            update environment_operations set ${closing('failed')},
                failure_message = 'Tenggat habis: worker berhenti melapor sebelum operasi selesai. Periksa database lingkungannya sebelum meminta ulang.'
            where status = 'running' and lease_until < ${now}
            returning environment_id
         )
         update environments set status = 'degraded', updated_at = ${now}
         where id in (select environment_id from expired) and status in ('provisioning', 'active')`,
    );
}

// Operasi tertua yang boleh diambil host ini, atau null: milik lingkungan yang sudah terikat ke host ini (didahulukan),
// atau yang belum terikat ke host mana pun. Lingkungan terikat ke host pertama yang mengambil operasinya.
export async function claimOperation(
    db: Database,
    hostId: string,
): Promise<ClaimedOperation | null> {
    return db.transaction(async () => {
        await expireStale(db);
        const claimed = await db.one(
            claimedSchema,
            `with next as (
                select o.id, o.environment_id from environment_operations o
                join environments e on e.id = o.environment_id
                where o.status = 'requested' and e.hosting = 'provider' and e.deleted_at is null
                  and (e.runtime_host_id is null or e.runtime_host_id = $1)
                order by e.runtime_host_id is null, o.requested_at, o.id limit 1
                for update of o, e skip locked
             )
             update environment_operations o set status = 'running', started_at = ${now},
                lease_until = ${now} + make_interval(mins => $2)
             from next where o.id = next.id
             returning o.id, o.operation, o.environment_id, o.parameters, ${iso('o.lease_until')} as lease_until`,
            [hostId, leaseMinutes],
        );
        if (!claimed) return null;
        await db.execute(
            `update environments set runtime_host_id = $2, updated_at = ${now} where id = $1 and runtime_host_id is null`,
            [claimed.environment_id, hostId],
        );
        return claimed;
    });
}

export const stepSchema = z.strictObject({
    status: z.enum(['running', 'succeeded', 'failed']),
    step: z.string().min(1).max(60),
    failure_message: z.string().max(4000).nullable().optional(),
});
export type Step = z.infer<typeof stepSchema>;

// Status lingkungan sesudah operasinya ditutup. Penyiapan yang gagal meninggalkan lingkungan degraded, bukan
// provisioning, supaya konsol tahu ada yang harus diperiksa.
const environmentAfter = {
    provision: { succeeded: 'active', failed: 'degraded' },
    migrate: { succeeded: 'active', failed: 'degraded' },
} as const satisfies Record<
    EnvironmentOperation,
    Record<'succeeded' | 'failed', string>
>;

// Langkah running memperpanjang tenggat; succeeded dan failed menutup operasi dan mengubah status lingkungannya dalam
// transaksi yang sama. null berarti operasi tidak lagi dipegang host ini, dan worker harus berhenti.
export async function recordStep(
    db: Database,
    hostId: string,
    operationId: string,
    step: Step,
): Promise<{ lease_until: string | null } | null> {
    return db.transaction(async () => {
        const held = await db.one(
            z.object({
                environment_id: z.string(),
                operation: z.enum(environmentOperations),
            }),
            `select o.environment_id, o.operation from environment_operations o
             join environments e on e.id = o.environment_id
             where o.id = $1 and e.runtime_host_id = $2 and o.status = 'running' and o.lease_until >= ${now}
             for update of o`,
            [operationId, hostId],
        );
        if (!held) return null;
        if (step.status === 'running')
            return (
                (await db.one(
                    z.object({ lease_until: z.string() }),
                    `update environment_operations set step = $2, lease_until = ${now} + make_interval(mins => $3)
                     where id = $1 returning ${iso('lease_until')} as lease_until`,
                    [operationId, step.step, leaseMinutes],
                )) ?? null
            );
        const failure =
            step.status === 'failed'
                ? step.failure_message?.trim() ||
                  'Worker melaporkan gagal tanpa menyebut sebabnya.'
                : null;
        await db.execute(
            `update environment_operations set ${closing(step.status)}, step = $2, failure_message = $3 where id = $1`,
            [operationId, step.step, failure],
        );
        await db.execute(
            `update environments set status = $2, updated_at = ${now}${
                step.status === 'succeeded'
                    ? `, schema_migrated_at = ${now}`
                    : ''
            } where id = $1`,
            [
                held.environment_id,
                environmentAfter[held.operation][step.status],
            ],
        );
        return { lease_until: null };
    });
}

// Meminta worker memigrasi database lingkungan ke skema kode di host runtime-nya. Hanya untuk lingkungan dengan
// database sendiri yang penyiapannya pernah selesai: database bersama dimigrasi saat runtime di-deploy, dan penyiapan
// yang belum selesai harus diulang, bukan dimigrasi.
export async function requestMigration(
    db: Database,
    actor: { operatorId: string; ipAddress: string | null },
    environmentId: string,
): Promise<{ id: string }> {
    const id = Bun.randomUUIDv7();
    return db.transaction(async () => {
        const environment = await db.one(
            z.object({
                database_name: z.string().nullable(),
                hosting: z.string(),
                provisioned: z.boolean(),
            }),
            `select database_name, hosting, schema_migrated_at is not null as provisioned
             from environments where id = $1 and deleted_at is null for update`,
            [environmentId],
        );
        if (!environment)
            throw new HttpFailure(404, {
                error: 'environment_not_found',
                message: 'Lingkungan tidak ditemukan.',
            });
        if (environment.hosting !== 'provider' || !environment.database_name)
            throw new HttpFailure(409, {
                error: 'environment_not_migratable',
                message:
                    'Lingkungan ini tidak punya database sendiri di server kita, jadi skemanya diperbarui bersama runtime-nya.',
            });
        if (!environment.provisioned)
            throw new HttpFailure(409, {
                error: 'environment_not_provisioned',
                message:
                    'Penyiapan lingkungan ini belum pernah selesai, jadi skemanya belum bisa diperbarui.',
            });
        try {
            // Savepoint: transaksi PostgreSQL batal seluruhnya bila 23505 ditangkap tanpanya.
            await db.transaction(() =>
                db.execute(
                    `insert into environment_operations (id, environment_id, operation, status, requested_by, parameters,
                        requested_at)
                     values ($1, $2, 'migrate', 'requested', $3, $4::text::jsonb, ${now})`,
                    [
                        id,
                        environmentId,
                        actor.operatorId,
                        JSON.stringify({ database: environment.database_name }),
                    ],
                ),
            );
        } catch (error) {
            if (sqlErrorCode(error) === '23505')
                throw new HttpFailure(409, {
                    error: 'operation_pending',
                    message:
                        'Lingkungan ini masih punya operasi yang belum selesai.',
                });
            throw error;
        }
        await recordAudit(db, {
            ...actor,
            action: 'environment.operation.requested',
            subjectType: 'environment',
            subjectId: environmentId,
            detail: { operation_id: id, operation: 'migrate' },
        });
        return { id };
    });
}
