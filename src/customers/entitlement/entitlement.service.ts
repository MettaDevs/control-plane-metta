import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';

type Actor = { operatorId: string; ipAddress: string | null };

const now = "now() at time zone 'utc'";
const today = `(${now})::date`;

// Hari terakhir module boleh dipakai; kosong berarti tanpa batas. Hari yang sudah lewat ditolak, karena entitlement yang
// berakhir kemarin sama saja dengan mencabutnya.
const endsOnSchema = z.iso
    .date('Isi tanggal dengan format yang benar.')
    .nullable();

export const entitlementInputSchema = z.strictObject({
    module_id: z.string('Pilih module.').min(1, 'Pilih module.').max(80),
    ends_on: endsOnSchema,
});
export const entitlementChangeSchema = z.strictObject({
    ends_on: endsOnSchema,
});

export function entitlementInputErrors(
    error: z.ZodError,
): Record<string, string[]> {
    return Object.fromEntries(
        error.issues.map((issue) => [
            issue.path.join('.') || '_form',
            [issue.message],
        ]),
    );
}

function refuseEndsOn(): never {
    throw new HttpFailure(422, {
        message: 'Periksa isian module.',
        errors: { ends_on: ['Tanggal berakhir tidak boleh sebelum hari ini.'] },
    });
}

async function assertNotPast(db: Database, endsOn: string | null) {
    if (endsOn === null) return;
    const past = await db.one(
        z.object({ past: z.boolean() }),
        `select $1::date < ${today} as past`,
        [endsOn],
    );
    if (past?.past) refuseEndsOn();
}

// Module yang dilaporkan host runtime, beserta host hidup yang membawanya. Module yang tidak lagi dibawa host mana pun
// tetap tampil tanpa host, supaya entitlement lama yang menunjuknya masih terbaca.
export async function listCatalog(db: Database) {
    return db.rows(
        z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            hosts: z.array(z.string()),
        }),
        `select m.id, m.name, m.description,
            coalesce((select json_agg(h.name order by h.name) from runtime_hosts h
                      where h.revoked_at is null and h.reported_modules ? m.id), '[]') as hosts
         from catalog_modules m order by m.name, m.id`,
    );
}

export async function grantEntitlement(
    db: Database,
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof entitlementInputSchema>,
): Promise<{ id: string }> {
    return db.transaction(async () => {
        const tenant = await db.one(
            z.object({ id: z.string() }),
            'select id from tenants where id = $1',
            [tenantId],
        );
        if (!tenant)
            throw new HttpFailure(404, {
                error: 'tenant_not_found',
                message: 'Tenant tidak ditemukan.',
            });
        const module = await db.one(
            z.object({ id: z.string() }),
            'select id from catalog_modules where id = $1',
            [input.module_id],
        );
        if (!module)
            throw new HttpFailure(422, {
                message: 'Periksa isian module.',
                errors: {
                    module_id: [
                        'Module ini belum pernah dilaporkan host runtime mana pun.',
                    ],
                },
            });
        await assertNotPast(db, input.ends_on);
        const id = Bun.randomUUIDv7();
        try {
            await db.transaction(() =>
                db.execute(
                    `insert into tenant_module_entitlements (id, tenant_id, module_id, ends_on, created_at, updated_at)
                     values ($1, $2, $3, $4, ${now}, ${now})`,
                    [id, tenantId, input.module_id, input.ends_on],
                ),
            );
        } catch (error) {
            if (sqlErrorCode(error) !== '23505') throw error;
            throw new HttpFailure(422, {
                message: 'Periksa isian module.',
                errors: {
                    module_id: [
                        'Tenant ini sudah berhak memakai module ini. Ubah tanggal berakhirnya bila perlu.',
                    ],
                },
            });
        }
        await recordAudit(db, {
            ...actor,
            action: 'tenant.module_entitled',
            subjectType: 'tenant',
            subjectId: tenantId,
            detail: {
                entitlement_id: id,
                module_id: input.module_id,
                ends_on: input.ends_on,
            },
        });
        return { id };
    });
}

async function liveEntitlement(db: Database, entitlementId: string) {
    const entitlement = await db.one(
        z.object({
            tenant_id: z.string(),
            module_id: z.string(),
            ends_on: z.string().nullable(),
        }),
        `select tenant_id, module_id, to_char(ends_on, 'YYYY-MM-DD') as ends_on
         from tenant_module_entitlements where id = $1 and deleted_at is null for update`,
        [entitlementId],
    );
    if (!entitlement)
        throw new HttpFailure(404, {
            error: 'entitlement_not_found',
            message: 'Hak module ini tidak ditemukan atau sudah dicabut.',
        });
    return entitlement;
}

export async function changeEntitlement(
    db: Database,
    actor: Actor,
    entitlementId: string,
    change: z.infer<typeof entitlementChangeSchema>,
): Promise<void> {
    await db.transaction(async () => {
        const entitlement = await liveEntitlement(db, entitlementId);
        await assertNotPast(db, change.ends_on);
        await db.execute(
            `update tenant_module_entitlements set ends_on = $2, updated_at = ${now} where id = $1`,
            [entitlementId, change.ends_on],
        );
        await recordAudit(db, {
            ...actor,
            action: 'tenant.module_entitlement_changed',
            subjectType: 'tenant',
            subjectId: entitlement.tenant_id,
            detail: {
                entitlement_id: entitlementId,
                module_id: entitlement.module_id,
                ends_on: { from: entitlement.ends_on, to: change.ends_on },
            },
        });
    });
}

// Mencabut hanya menghentikan pemakaian: data yang sudah dibuat dengan module itu tetap di database lingkungannya.
export async function revokeEntitlement(
    db: Database,
    actor: Actor,
    entitlementId: string,
): Promise<void> {
    await db.transaction(async () => {
        const entitlement = await liveEntitlement(db, entitlementId);
        await db.execute(
            `update tenant_module_entitlements set deleted_at = ${now}, updated_at = ${now} where id = $1`,
            [entitlementId],
        );
        await recordAudit(db, {
            ...actor,
            action: 'tenant.module_entitlement_revoked',
            subjectType: 'tenant',
            subjectId: entitlement.tenant_id,
            detail: {
                entitlement_id: entitlementId,
                module_id: entitlement.module_id,
            },
        });
    });
}
