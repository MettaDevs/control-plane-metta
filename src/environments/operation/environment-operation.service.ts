import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';

// Antrean lingkungan, model tarik: konsol meminta, worker operations-metta di host runtime mengambil (claim) satu per
// satu dengan tenggat, melaporkan langkahnya, lalu menutupnya. Setiap langkah dan penutupan mensyaratkan operasi masih
// dipegang host itu dan tenggatnya belum lewat, jadi worker yang tenggatnya sudah habis tidak bisa lagi mengaktifkan
// lingkungan (di CoreERP penutupan sukses tidak memeriksa ini). Tidak ada penjadwal: tenggat yang lewat ditutup saat
// antrean dibaca.
export const leaseMinutes = 30;

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
} as const;

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
                operation: z.enum(['provision']),
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
