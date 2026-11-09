import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';

// Antrean operasi situs, sama dengan konsol CoreERP: operator meminta, agen mengambil (claim) satu per satu dengan
// tenggat, melaporkan langkahnya, lalu menutupnya. Tidak ada penjadwal; tenggat yang lewat dan permintaan yang basi
// ditutup saat antrean dibaca.
export const leaseMinutes = 15;
const requestExpiryDays = 7;
export const manualOperations = [
    'backup',
    'rotate_key',
    'send_diagnostics',
] as const;
export type ManualOperation = (typeof manualOperations)[number];

const now = "now() at time zone 'utc'";
const iso = (column: string) =>
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"')`;
// Setiap penutupan membuang hash password admin dari parameter operasi install, supaya hash itu tidak tertinggal di
// baris yang tidak lagi dibaca siapa pun. Operator jsonb `-` tidak mengubah parameter yang tidak membawanya.
const closing = (status: string) =>
    `status = '${status}', finished_at = ${now}, updated_at = ${now}, parameters = parameters - 'admin_password_hash'`;

const claimedSchema = z.object({
    id: z.string(),
    operation: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    lease_until: z.string(),
});
export type ClaimedOperation = z.infer<typeof claimedSchema>;

// Menutup operasi situs ini yang tenggatnya lewat (gagal) dan permintaan yang tidak diambil tujuh hari (kedaluwarsa).
export async function expireStale(db: Database, siteId: string): Promise<void> {
    await db.execute(
        `update site_operations set ${closing('failed')},
            failure_message = 'Tenggat habis: agen berhenti melapor sebelum operasi selesai. Periksa keadaan server sebelum meminta ulang.'
         where site_id = $1 and status = 'running' and lease_until < ${now}`,
        [siteId],
    );
    await db.execute(
        `update site_operations set ${closing('expired')}
         where site_id = $1 and status = 'requested' and expires_at <= ${now}`,
        [siteId],
    );
}

// Operasi tertua yang boleh diambil sekarang, atau null. upgrade hanya di dalam jam pembaruan situs (yang boleh
// melewati tengah malam; tanpa jam pembaruan berarti kapan saja), install hanya bila rilisnya sudah ditentukan, dan
// operasi lain kapan saja. Satu situs hanya punya satu operasi yang berjalan.
export async function claimOperation(
    db: Database,
    siteId: string,
): Promise<ClaimedOperation | null> {
    return db.transaction(async () => {
        await db.execute('select id from sites where id = $1 for update', [
            siteId,
        ]);
        await expireStale(db, siteId);
        const running = await db.one(
            z.object({ id: z.string() }),
            `select id from site_operations where site_id = $1 and status = 'running'`,
            [siteId],
        );
        if (running) return null;
        return (
            (await db.one(
                claimedSchema,
                `with window_open as (
                    select update_window_start is null or update_window_end is null
                        or case when update_window_start <= update_window_end
                            then (now() at time zone timezone)::time(0) between update_window_start and update_window_end
                            else (now() at time zone timezone)::time(0) >= update_window_start
                                or (now() at time zone timezone)::time(0) <= update_window_end
                        end as open
                    from sites where id = $1
                 ), next as (
                    select o.id from site_operations o
                    where o.site_id = $1 and o.status = 'requested'
                      and (o.operation <> 'install' or coalesce(o.parameters->>'release', '') <> '')
                      and (o.operation <> 'upgrade' or (select open from window_open))
                    order by o.requested_at, o.id limit 1
                 )
                 update site_operations o set status = 'running', started_at = ${now},
                    lease_until = ${now} + make_interval(mins => $2), updated_at = ${now}
                 from next where o.id = next.id
                 returning o.id, o.operation, o.parameters, ${iso('o.lease_until')} as lease_until`,
                [siteId, leaseMinutes],
            )) ?? null
        );
    });
}

export const stepSchema = z.strictObject({
    status: z.enum(['running', 'succeeded', 'failed']),
    step: z.string().min(1).max(120),
    failure_message: z.string().max(4000).nullable().optional(),
});
export type Step = z.infer<typeof stepSchema>;

// Langkah running memperpanjang tenggat; succeeded dan failed menutup operasi. Operasi milik situs lain, yang sudah
// ditutup, atau yang tenggatnya lewat tidak lagi dipegang agen ini: null, dan agen harus berhenti melapor.
export async function recordStep(
    db: Database,
    siteId: string,
    operationId: string,
    step: Step,
): Promise<{ lease_until: string | null } | null> {
    return db.transaction(async () => {
        const held = await db.one(
            z.object({ id: z.string() }),
            `select id from site_operations
             where id = $1 and site_id = $2 and status = 'running' and lease_until >= ${now}
             for update`,
            [operationId, siteId],
        );
        if (!held) return null;
        if (step.status === 'running')
            return (
                (await db.one(
                    z.object({ lease_until: z.string() }),
                    `update site_operations set step = $2, lease_until = ${now} + make_interval(mins => $3),
                        updated_at = ${now}
                     where id = $1 returning ${iso('lease_until')} as lease_until`,
                    [operationId, step.step, leaseMinutes],
                )) ?? null
            );
        const failure =
            step.status === 'failed'
                ? step.failure_message?.trim() ||
                  'Agen melaporkan gagal tanpa menyebut sebabnya.'
                : null;
        await db.execute(
            `update site_operations set ${closing(step.status)}, step = $2, failure_message = $3 where id = $1`,
            [operationId, step.step, failure],
        );
        return { lease_until: null };
    });
}

type Actor = { operatorId: string; ipAddress: string };

const siteStateSchema = z.object({
    enrolled: z.boolean(),
    revoked: z.boolean(),
});

async function lockSite(db: Database, siteId: string) {
    const site = await db.one(
        siteStateSchema,
        `select public_key is not null as enrolled, revoked_at is not null as revoked
         from sites where id = $1 for update`,
        [siteId],
    );
    if (!site)
        throw new HttpFailure(404, {
            error: 'site_not_found',
            message: 'Situs tidak ditemukan.',
        });
    return site;
}

export async function requestOperation(
    db: Database,
    actor: Actor,
    siteId: string,
    operation: ManualOperation,
): Promise<{ id: string }> {
    const id = Bun.randomUUIDv7();
    return db.transaction(async () => {
        const site = await lockSite(db, siteId);
        if (site.revoked)
            throw new HttpFailure(409, {
                error: 'site_revoked',
                message: 'Situs ini sudah dicabut.',
            });
        if (!site.enrolled)
            throw new HttpFailure(409, {
                error: 'site_not_enrolled',
                message:
                    'Situs ini belum terdaftar; agen belum pernah tersambung.',
            });
        try {
            await db.transaction(() =>
                db.execute(
                    `insert into site_operations (id, site_id, operation, parameters, status, requested_by, requested_at,
                                                  expires_at, created_at, updated_at)
                     values ($1, $2, $3, '{}'::jsonb, 'requested', $4, ${now},
                             ${now} + make_interval(days => $5), ${now}, ${now})`,
                    [
                        id,
                        siteId,
                        operation,
                        actor.operatorId,
                        requestExpiryDays,
                    ],
                ),
            );
        } catch (error) {
            if (sqlErrorCode(error) === '23505')
                throw new HttpFailure(409, {
                    error: 'operation_pending',
                    message:
                        'Operasi yang sama untuk situs ini masih menunggu diambil agen.',
                });
            throw error;
        }
        await recordAudit(db, {
            ...actor,
            action: 'site.operation.requested',
            subjectType: 'site',
            subjectId: siteId,
            detail: { operation_id: id, operation, release: null },
        });
        return { id };
    });
}

export async function cancelOperation(
    db: Database,
    actor: Actor,
    siteId: string,
    operationId: string,
): Promise<void> {
    await db.transaction(async () => {
        const cancelled = await db.one(
            z.object({ operation: z.string() }),
            `update site_operations set ${closing('cancelled')}
             where id = $1 and site_id = $2 and status = 'requested' returning operation`,
            [operationId, siteId],
        );
        if (!cancelled)
            throw new HttpFailure(409, {
                error: 'operation_not_pending',
                message:
                    'Hanya operasi yang belum diambil agen yang dapat dibatalkan.',
            });
        await recordAudit(db, {
            ...actor,
            action: 'site.operation.cancelled',
            subjectType: 'site',
            subjectId: siteId,
            detail: {
                operation_id: operationId,
                operation: cancelled.operation,
            },
        });
    });
}

// Mencabut situs: tanda tangan agennya langsung ditolak, dan operasi yang belum diambil dibatalkan. Operasi yang
// sedang berjalan ditutup sebagai gagal begitu tenggatnya lewat, karena agennya tidak bisa lagi melapor.
export async function revokeSite(
    db: Database,
    actor: Actor,
    siteId: string,
): Promise<void> {
    await db.transaction(async () => {
        const site = await lockSite(db, siteId);
        if (site.revoked)
            throw new HttpFailure(409, {
                error: 'site_revoked',
                message: 'Situs ini sudah dicabut.',
            });
        await db.execute(
            `update sites set revoked_at = ${now}, updated_at = ${now} where id = $1`,
            [siteId],
        );
        const cancelled = await db.execute(
            `update site_operations set ${closing('cancelled')} where site_id = $1 and status = 'requested'`,
            [siteId],
        );
        await recordAudit(db, {
            ...actor,
            action: 'site.revoked',
            subjectType: 'site',
            subjectId: siteId,
            detail: { cancelled_operations: cancelled },
        });
    });
}
