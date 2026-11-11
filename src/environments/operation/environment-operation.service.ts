import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import { environmentDatabaseName } from '../environment-database.ts';

// Antrean lingkungan, model tarik: konsol meminta, worker operations-metta di host runtime mengambil (claim) satu per
// satu dengan tenggat, melaporkan langkahnya, lalu menutupnya. Setiap langkah dan penutupan mensyaratkan operasi masih
// dipegang host itu dan tenggatnya belum lewat, jadi worker yang tenggatnya sudah habis tidak bisa lagi mengaktifkan
// lingkungan (di CoreERP penutupan sukses tidak memeriksa ini). Tidak ada penjadwal: tenggat yang lewat ditutup saat
// antrean dibaca.
export const leaseMinutes = 30;

export const environmentOperations = [
    'provision',
    'migrate',
    'convert',
    'expire',
    'restore',
    'purge',
    'copy',
] as const;
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
            returning environment_id, operation
         )
         update environments set status = 'degraded', updated_at = ${now}
         where id in (select environment_id from expired where operation in ('provision', 'migrate', 'copy'))
           and status in ('provisioning', 'copying', 'active')`,
    );
}

// Operasi yang tidak diminta operator: diantrekan setiap kali host pemegang lingkungannya meminta pekerjaan, jadi tidak
// ada penjadwal yang harus dijalankan terpisah.
// - expire: demo yang tanggal berakhirnya lewat. Status tidak disaring; demo yang degraded pun kedaluwarsa.
// - purge: lingkungan yang dihapus lunak dan masa tenggangnya habis. Produksi tidak pernah, apa pun statusnya, dan CHECK
//   environments_produksi_tidak_dibuang menolaknya sekali lagi.
// Lingkungan yang masih punya operasi terbuka dilewati, dan operasi yang baru saja gagal tidak diantrekan ulang selama
// sejam supaya worker tidak mengulang kegagalan yang sama setiap kali meminta.
const scheduledRetryMinutes = 60;
const scheduledOperations = {
    expire: `e.kind = 'demo' and e.deleted_at is null and e.expires_at <= ${now}`,
    purge: `e.kind <> 'production' and e.status = 'soft_deleted' and e.deleted_at is not null
        and e.purged_at is null and e.purge_after <= ${now}`,
} as const satisfies Partial<Record<EnvironmentOperation, string>>;

function scheduledParameters(
    operation: keyof typeof scheduledOperations,
    environment: {
        tenant_slug: string;
        kind: string;
        database_name: string | null;
    },
): Record<string, unknown> {
    switch (operation) {
        case 'expire':
            return {
                tenant_slug: environment.tenant_slug,
                database: environment.database_name,
            };
        case 'purge':
            return {
                tenant_slug: environment.tenant_slug,
                kind: environment.kind,
                database: environment.database_name,
            };
        default: {
            const unknown: never = operation;
            throw new Error(
                `Operasi terjadwal tidak dikenal: ${String(unknown)}`,
            );
        }
    }
}

async function enqueueScheduled(db: Database, hostId: string): Promise<void> {
    for (const [operation, due] of Object.entries(scheduledOperations) as [
        keyof typeof scheduledOperations,
        string,
    ][]) {
        const environments = await db.rows(
            z.object({
                id: z.string(),
                tenant_slug: z.string(),
                kind: z.string(),
                database_name: z.string().nullable(),
            }),
            `select e.id, t.slug as tenant_slug, e.kind, e.database_name
             from environments e join tenants t on t.id = e.tenant_id
             where e.runtime_host_id = $1 and e.hosting = 'provider' and ${due}
               and not exists (select 1 from environment_operations x where x.environment_id = e.id
                               and x.status in ('requested', 'running'))
               and not exists (select 1 from environment_operations x where x.environment_id = e.id
                               and x.operation = $2 and x.finished_at > ${now} - make_interval(mins => $3))`,
            [hostId, operation, scheduledRetryMinutes],
        );
        for (const environment of environments)
            await db.execute(
                `insert into environment_operations (id, environment_id, operation, status, parameters, requested_at)
                 values ($1, $2, $3, 'requested', $4::text::jsonb, ${now}) on conflict do nothing`,
                [
                    Bun.randomUUIDv7(),
                    environment.id,
                    operation,
                    JSON.stringify(scheduledParameters(operation, environment)),
                ],
            );
    }
}

// Operasi tertua yang boleh diambil host ini, atau null: milik lingkungan yang sudah terikat ke host ini (didahulukan),
// atau yang belum terikat ke host mana pun. Lingkungan terikat ke host pertama yang mengambil operasinya.
export async function claimOperation(
    db: Database,
    hostId: string,
): Promise<ClaimedOperation | null> {
    return db.transaction(async () => {
        await expireStale(db);
        await enqueueScheduled(db, hostId);
        const claimed = await db.one(
            claimedSchema,
            `with next as (
                select o.id, o.environment_id from environment_operations o
                join environments e on e.id = o.environment_id
                where o.status = 'requested' and e.hosting = 'provider'
                  and (e.deleted_at is null or o.operation in ('restore', 'purge'))
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

// Status lingkungan sesudah operasinya ditutup (null: tidak diubah), dan apakah penutupan sukses berarti skemanya baru
// dimigrasi. Penyiapan dan migrate yang gagal meninggalkan lingkungan degraded supaya konsol tahu ada yang harus
// diperiksa. Konversi dan expire yang gagal tidak mengubah apa pun: demonya masih utuh, dan yang gagal cukup operasinya.
// Expire yang sukses menghapus lunak lingkungannya (softDelete), bukan sekadar mengganti status.
const environmentAfter = {
    provision: { succeeded: 'active', failed: 'degraded', migrates: true },
    migrate: { succeeded: 'active', failed: 'degraded', migrates: true },
    convert: { succeeded: 'active', failed: null, migrates: false },
    expire: { succeeded: null, failed: null, migrates: false },
    restore: { succeeded: null, failed: null, migrates: false },
    purge: { succeeded: null, failed: null, migrates: false },
    copy: { succeeded: 'active', failed: 'degraded', migrates: true },
} as const satisfies Record<
    EnvironmentOperation,
    { succeeded: string | null; failed: string | null; migrates: boolean }
>;

// Hapus lunak: status, deleted_at, dan purge_after dalam satu pernyataan, karena CHECK environments_hapus_berpasangan
// dan environments_status_hapus_sejalan menolak ketiganya berubah sendiri-sendiri. Isi database lingkungan masih utuh
// sampai purge_after; status sebelumnya disimpan di detail operasi supaya restore tidak perlu menebaknya.
async function softDelete(
    db: Database,
    operationId: string,
    environmentId: string,
    graceDays: number,
): Promise<void> {
    const deleted = await db.one(
        z.object({ previous_status: z.string(), purge_after: z.string() }),
        `with previous as (select status from environments where id = $1 and deleted_at is null for update)
         update environments e set status = 'soft_deleted', deleted_at = ${now},
             purge_after = ${now} + make_interval(days => $2), updated_at = ${now}
         from previous where e.id = $1
         returning previous.status as previous_status, ${iso('e.purge_after')} as purge_after`,
        [environmentId, graceDays],
    );
    if (deleted)
        await db.execute(
            'update environment_operations set detail = detail || $2::text::jsonb where id = $1',
            [operationId, JSON.stringify(deleted)],
        );
}

// Demo menjadi produksi: jenis, slug, sambungan keluar, dan tanggal berakhir dalam satu pernyataan, karena CHECK
// environments_keluar_ikut_jenis menolak jenis dan sambungan keluar yang berubah sendiri-sendiri. Nama bawaan "Demo"
// ikut menjadi "Produksi"; nama pilihan operator dipertahankan. Mengembalikan pesan gagal bila tenant ini sudah
// memperoleh produksi lain sejak konversi diminta.
async function promoteToProduction(
    db: Database,
    environmentId: string,
): Promise<string | null> {
    try {
        await db.transaction(() =>
            db.execute(
                `update environments set kind = 'production', slug = 'production', outbound_allowed = true,
                    expires_at = null, name = case when name = 'Demo' then 'Produksi' else name end, updated_at = ${now}
                 where id = $1 and kind = 'demo'`,
                [environmentId],
            ),
        );
        return null;
    } catch (error) {
        if (sqlErrorCode(error) !== '23505') throw error;
        return 'Tenant ini memperoleh produksi lain sejak konversi diminta, jadi demo ini tidak dijadikan produksi. Worker sudah memindah alamat produksi di runtime ke database demo ini; periksa kedua lingkungan sebelum melanjutkan.';
    }
}

// Status yang boleh dikembalikan apa adanya dari catatan expire. copying tidak: penyalinannya sudah lama mati. Tanpa
// catatan yang dapat dipercaya, lingkungan kembali degraded, karena isinya ada tetapi tidak ada yang tahu ia sehat.
const restorableStatuses = new Set([
    'provisioning',
    'active',
    'maintenance',
    'degraded',
    'suspended',
]);

// Melepas hapus lunak: status, deleted_at, dan purge_after dalam satu pernyataan, cermin softDelete. Demo mendapat
// tanggal berakhir baru yang dipilih operator saat meminta, supaya ia tidak langsung kedaluwarsa lagi. Mengembalikan
// pesan gagal bila tenant ini sudah memperoleh lingkungan hidup lain dengan jenis yang sama.
async function releaseDeletion(
    db: Database,
    operationId: string,
    environmentId: string,
): Promise<string | null> {
    const request = await db.one(
        z.object({
            expires_at: z.string().nullable(),
            previous_status: z.string().nullable(),
        }),
        `select o.detail ->> 'expires_at' as expires_at,
            (select x.detail ->> 'previous_status' from environment_operations x
             where x.environment_id = o.environment_id and x.operation = 'expire' and x.status = 'succeeded'
             order by x.finished_at desc, x.id desc limit 1) as previous_status
         from environment_operations o where o.id = $1`,
        [operationId],
    );
    const status =
        request?.previous_status &&
        restorableStatuses.has(request.previous_status)
            ? request.previous_status
            : 'degraded';
    try {
        await db.transaction(() =>
            db.execute(
                `update environments set status = $2, deleted_at = null, purge_after = null,
                    expires_at = case when kind = 'demo' then $3::date else expires_at end, updated_at = ${now}
                 where id = $1 and deleted_at is not null and purged_at is null`,
                [environmentId, status, request?.expires_at ?? null],
            ),
        );
    } catch (error) {
        if (sqlErrorCode(error) !== '23505') throw error;
        return 'Tenant ini memperoleh lingkungan hidup lain dengan jenis yang sama sejak pemulihan diminta, jadi lingkungan ini tetap dihapus. Worker sudah menyalakan lagi alamatnya di runtime; periksa kedua lingkungan sebelum melanjutkan.';
    }
    await db.execute(
        'update environment_operations set detail = detail || $2::text::jsonb where id = $1',
        [operationId, JSON.stringify({ restored_status: status })],
    );
    return null;
}

// Langkah running memperpanjang tenggat; succeeded dan failed menutup operasi dan mengubah status lingkungannya dalam
// transaksi yang sama. null berarti operasi tidak lagi dipegang host ini, dan worker harus berhenti.
export async function recordStep(
    db: Database,
    hostId: string,
    operationId: string,
    step: Step,
    purgeGraceDays: number,
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
        const promotionFailure =
            step.status !== 'succeeded'
                ? null
                : held.operation === 'convert'
                  ? await promoteToProduction(db, held.environment_id)
                  : held.operation === 'restore'
                    ? await releaseDeletion(
                          db,
                          operationId,
                          held.environment_id,
                      )
                    : null;
        const status = promotionFailure ? 'failed' : step.status;
        const failure =
            promotionFailure ??
            (step.status === 'failed'
                ? step.failure_message?.trim() ||
                  'Worker melaporkan gagal tanpa menyebut sebabnya.'
                : null);
        const after = environmentAfter[held.operation];
        await db.execute(
            `update environment_operations set ${closing(status)}, step = $2, failure_message = $3 where id = $1`,
            [operationId, step.step, failure],
        );
        // Worker sudah membuang databasenya. purged_at menjadi nisannya: barisnya dan riwayat operasinya tetap ada.
        if (held.operation === 'purge' && status === 'succeeded')
            await db.execute(
                `update environments set purged_at = ${now}, updated_at = ${now}
                 where id = $1 and deleted_at is not null and purged_at is null and kind <> 'production'`,
                [held.environment_id],
            );
        if (held.operation === 'copy' && status === 'succeeded')
            await db.execute(
                `update environments set copied_at = ${now}, updated_at = ${now} where id = $1`,
                [held.environment_id],
            );
        if (held.operation === 'expire' && status === 'succeeded')
            await softDelete(
                db,
                operationId,
                held.environment_id,
                purgeGraceDays,
            );
        const environmentStatus = after[status];
        if (environmentStatus)
            await db.execute(
                `update environments set status = $2, updated_at = ${now}${
                    status === 'succeeded' && after.migrates
                        ? `, schema_migrated_at = ${now}`
                        : ''
                } where id = $1`,
                [held.environment_id, environmentStatus],
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
        await insertOperation(db, id, environmentId, 'migrate', actor, {
            database: environment.database_name,
        });
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

// Meminta worker menjadikan demo produksi di tempat, beserta datanya: data yang diisi prospek selama demo adalah
// alasan ia membeli. Hanya demo aktif milik tenant yang belum punya produksi. Worker memindah alamatnya di runtime dari
// `<tenant>.demo.<base>` ke `<tenant>.<base>`; jenis lingkungan di sini baru berubah saat worker menutupnya sukses.
export async function requestConversion(
    db: Database,
    actor: { operatorId: string; ipAddress: string | null },
    environmentId: string,
): Promise<{ id: string }> {
    const id = Bun.randomUUIDv7();
    return db.transaction(async () => {
        const environment = await db.one(
            z.object({
                kind: z.string(),
                status: z.string(),
                hosting: z.string(),
                name: z.string(),
                database_name: z.string().nullable(),
                tenant_slug: z.string(),
                has_production: z.boolean(),
            }),
            `select e.kind, e.status, e.hosting, e.name, e.database_name, t.slug as tenant_slug,
                exists (select 1 from environments p where p.tenant_id = e.tenant_id and p.kind = 'production'
                        and p.deleted_at is null) as has_production
             from environments e join tenants t on t.id = e.tenant_id
             where e.id = $1 and e.deleted_at is null for update of e`,
            [environmentId],
        );
        if (!environment)
            throw new HttpFailure(404, {
                error: 'environment_not_found',
                message: 'Lingkungan tidak ditemukan.',
            });
        if (environment.kind !== 'demo' || environment.hosting !== 'provider')
            throw new HttpFailure(409, {
                error: 'environment_not_demo',
                message:
                    'Hanya lingkungan demo yang bisa dijadikan produksi. Sandbox adalah salinan produksi, jadi menjadikannya produksi berarti dua tempat berisi data yang sama.',
            });
        if (environment.status !== 'active')
            throw new HttpFailure(409, {
                error: 'environment_not_active',
                message:
                    'Demo ini belum aktif, jadi belum ada yang bisa dijadikan produksi.',
            });
        if (environment.has_production)
            throw new HttpFailure(409, {
                error: 'production_exists',
                message:
                    'Tenant ini sudah punya produksi. Satu tenant hanya punya satu produksi, jadi tentukan dulu nasib produksi yang ada.',
            });
        await insertOperation(db, id, environmentId, 'convert', actor, {
            tenant_slug: environment.tenant_slug,
            database: environment.database_name,
            name: environment.name === 'Demo' ? 'Produksi' : environment.name,
        });
        await recordAudit(db, {
            ...actor,
            action: 'environment.operation.requested',
            subjectType: 'environment',
            subjectId: environmentId,
            detail: { operation_id: id, operation: 'convert' },
        });
        return { id };
    });
}

// Satu operasi terbuka per lingkungan dijaga index unik, jadi permintaan kedua dijawab 409. Savepoint, karena transaksi
// PostgreSQL batal seluruhnya bila 23505 ditangkap tanpanya.
async function insertOperation(
    db: Database,
    id: string,
    environmentId: string,
    operation: EnvironmentOperation,
    actor: { operatorId: string },
    parameters: Record<string, unknown>,
    // Keputusan yang hanya dibaca control plane saat penutupan, tidak dikirim ke worker.
    detail: Record<string, unknown> = {},
): Promise<void> {
    try {
        await db.transaction(() =>
            db.execute(
                `insert into environment_operations (id, environment_id, operation, status, requested_by, parameters,
                    detail, requested_at)
                 values ($1, $2, $3, 'requested', $4, $5::text::jsonb, $6::text::jsonb, ${now})`,
                [
                    id,
                    environmentId,
                    operation,
                    actor.operatorId,
                    JSON.stringify(parameters),
                    JSON.stringify(detail),
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
}

// Meminta worker menyalakan lagi alamat lingkungan yang dihapus lunak, selama isinya masih ada: belum dibuang, dan masa
// tenggangnya belum habis (sesudahnya pemulihan berbalapan dengan pembuangan). Satu tenant hanya punya satu lingkungan
// hidup per jenis, karena alamatnya hanya memuat tenant dan jenis. Demo wajib diberi tanggal berakhir baru.
export async function requestRestore(
    db: Database,
    actor: { operatorId: string; ipAddress: string | null },
    environmentId: string,
    expiresAt: string | undefined,
): Promise<{ id: string }> {
    const id = Bun.randomUUIDv7();
    return db.transaction(async () => {
        const environment = await db.one(
            z.object({
                kind: z.string(),
                hosting: z.string(),
                deleted: z.boolean(),
                purged: z.boolean(),
                grace_over: z.boolean(),
                bound: z.boolean(),
                database_name: z.string().nullable(),
                tenant_slug: z.string(),
                occupied: z.boolean(),
            }),
            `select e.kind, e.hosting, e.deleted_at is not null as deleted, e.purged_at is not null as purged,
                coalesce(e.purge_after <= ${now}, false) as grace_over, e.runtime_host_id is not null as bound,
                e.database_name, t.slug as tenant_slug,
                exists (select 1 from environments o where o.tenant_id = e.tenant_id and o.kind = e.kind
                        and o.deleted_at is null and o.id <> e.id) as occupied
             from environments e join tenants t on t.id = e.tenant_id
             where e.id = $1 for update of e`,
            [environmentId],
        );
        if (!environment)
            throw new HttpFailure(404, {
                error: 'environment_not_found',
                message: 'Lingkungan tidak ditemukan.',
            });
        if (!environment.deleted)
            throw new HttpFailure(409, {
                error: 'environment_not_deleted',
                message: 'Lingkungan ini tidak sedang dihapus.',
            });
        if (environment.purged || environment.grace_over)
            throw new HttpFailure(409, {
                error: 'environment_purged',
                message:
                    'Masa tenggang lingkungan ini sudah habis, jadi isinya boleh dibuang kapan saja dan tidak bisa dipulihkan.',
            });
        if (environment.hosting !== 'provider' || !environment.bound)
            throw new HttpFailure(409, {
                error: 'environment_not_restorable',
                message:
                    'Lingkungan ini tidak pernah berjalan di host runtime kita, jadi tidak ada alamat yang bisa dinyalakan lagi.',
            });
        if (environment.occupied)
            throw new HttpFailure(409, {
                error: 'environment_kind_taken',
                message:
                    'Tenant ini sudah punya lingkungan hidup dengan jenis yang sama, jadi lingkungan ini tidak bisa dipulihkan.',
            });
        const today = new Date().toISOString().slice(0, 10);
        if (environment.kind === 'demo' && (!expiresAt || expiresAt <= today))
            throw new HttpFailure(422, {
                message: 'Periksa isian pemulihan.',
                errors: {
                    expires_at: [
                        'Pilih tanggal berakhir demo yang baru, paling cepat besok.',
                    ],
                },
            });
        await insertOperation(
            db,
            id,
            environmentId,
            'restore',
            actor,
            {
                tenant_slug: environment.tenant_slug,
                kind: environment.kind,
                database: environment.database_name,
            },
            { expires_at: environment.kind === 'demo' ? expiresAt : null },
        );
        await recordAudit(db, {
            ...actor,
            action: 'environment.operation.requested',
            subjectType: 'environment',
            subjectId: environmentId,
            detail: { operation_id: id, operation: 'restore' },
        });
        return { id };
    });
}

// Menyalin produksi menjadi sandbox baru milik tenant yang sama. Sandbox lahir di sini lebih dulu, berstatus copying dan
// terikat ke host yang sama dengan produksinya, karena worker membaca database produksi dari Postgres host itu. Worker
// menyalin, melucuti efek keluar yang ikut tersalin, memigrasi, memeriksa kesehatan, lalu mencatat alamatnya. Produksi
// tidak dihentikan: pg_dump membaca satu snapshot konsisten tanpa mengunci apa pun. Sandbox yang penyalinannya gagal
// (degraded) boleh diminta ulang dari produksi yang sama; sandbox yang sudah hidup tidak pernah ditimpa.
export async function requestCopy(
    db: Database,
    actor: { operatorId: string; ipAddress: string | null },
    sourceId: string,
    name: string,
): Promise<{ id: string; environment_id: string }> {
    const id = Bun.randomUUIDv7();
    return db.transaction(async () => {
        const source = await db.one(
            z.object({
                tenant_id: z.string(),
                tenant_slug: z.string(),
                kind: z.string(),
                status: z.string(),
                hosting: z.string(),
                database_name: z.string().nullable(),
                runtime_host_id: z.string().nullable(),
                busy: z.boolean(),
            }),
            `select e.tenant_id, t.slug as tenant_slug, e.kind, e.status, e.hosting, e.database_name, e.runtime_host_id,
                exists (select 1 from environment_operations o where o.environment_id = e.id
                        and o.status in ('requested', 'running')) as busy
             from environments e join tenants t on t.id = e.tenant_id
             where e.id = $1 and e.deleted_at is null for update of e`,
            [sourceId],
        );
        if (!source)
            throw new HttpFailure(404, {
                error: 'environment_not_found',
                message: 'Lingkungan tidak ditemukan.',
            });
        if (source.kind !== 'production' || source.hosting !== 'provider')
            throw new HttpFailure(409, {
                error: 'environment_not_copyable',
                message:
                    'Hanya produksi yang berjalan di server kita yang bisa disalin menjadi sandbox.',
            });
        if (source.status !== 'active' || !source.runtime_host_id)
            throw new HttpFailure(409, {
                error: 'environment_not_active',
                message:
                    'Produksi ini belum aktif, jadi belum ada yang bisa disalin.',
            });
        if (!source.database_name)
            throw new HttpFailure(409, {
                error: 'environment_shared_database',
                message:
                    'Produksi ini memakai database bersama, yang memuat data tenant lain, jadi tidak bisa disalin menjadi sandbox.',
            });
        if (source.busy)
            throw new HttpFailure(409, {
                error: 'operation_pending',
                message:
                    'Produksi ini masih punya operasi yang belum selesai. Salin setelah operasi itu selesai.',
            });
        const existing = await db.one(
            z.object({
                id: z.string(),
                status: z.string(),
                source_environment_id: z.string().nullable(),
                database_name: z.string().nullable(),
            }),
            `select id, status, source_environment_id, database_name from environments
             where tenant_id = $1 and kind = 'sandbox' and deleted_at is null for update`,
            [source.tenant_id],
        );
        if (
            existing &&
            !(
                existing.status === 'degraded' &&
                existing.source_environment_id === sourceId
            )
        )
            throw new HttpFailure(409, {
                error: 'sandbox_exists',
                message:
                    'Tenant ini sudah punya sandbox. Hapus sandbox itu dulu bila ingin salinan baru.',
            });
        const sandboxId = existing?.id ?? Bun.randomUUIDv7();
        const database =
            existing?.database_name ??
            environmentDatabaseName(source.tenant_slug, 'sandbox', sandboxId);
        if (existing)
            await db.execute(
                `update environments set status = 'copying', name = $2, updated_at = ${now} where id = $1`,
                [sandboxId, name],
            );
        else
            await db.execute(
                `insert into environments (id, tenant_id, kind, name, slug, database_name, status, source_environment_id,
                    outbound_allowed, hosting, runtime_host_id, created_by, created_at, updated_at)
                 values ($1, $2, 'sandbox', $3, 'sandbox', $4, 'copying', $5, false, 'provider', $6, $7, ${now}, ${now})`,
                [
                    sandboxId,
                    source.tenant_id,
                    name,
                    database,
                    sourceId,
                    source.runtime_host_id,
                    actor.operatorId,
                ],
            );
        await insertOperation(db, id, sandboxId, 'copy', actor, {
            tenant_id: source.tenant_id,
            tenant_slug: source.tenant_slug,
            name,
            source_database: source.database_name,
            database,
        });
        await recordAudit(db, {
            ...actor,
            action: 'environment.operation.requested',
            subjectType: 'environment',
            subjectId: sandboxId,
            detail: {
                operation_id: id,
                operation: 'copy',
                source_environment_id: sourceId,
            },
        });
        return { id, environment_id: sandboxId };
    });
}
