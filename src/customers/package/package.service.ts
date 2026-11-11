import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';

type Actor = { operatorId: string; ipAddress: string | null };

const now = "now() at time zone 'utc'";

export const packageInputSchema = z.strictObject({
    name: z
        .string('Isi nama susunan module.')
        .trim()
        .min(1, 'Isi nama susunan module.')
        .max(150, 'Nama susunan module paling panjang 150 karakter.'),
    description: z
        .string()
        .trim()
        .max(1000, 'Deskripsi paling panjang 1000 karakter.')
        .nullable()
        .transform((value) => value || null),
    module_ids: z
        .array(z.string().min(1).max(80), 'Pilih module.')
        .min(1, 'Pilih paling sedikit satu module.')
        .max(100)
        .transform((ids) => [...new Set(ids)].sort()),
});
export type PackageInput = z.infer<typeof packageInputSchema>;

export const packageGrantSchema = z.strictObject({
    package_id: z.uuid('Pilih module.'),
    ends_on: z.iso.date('Isi tanggal dengan format yang benar.').nullable(),
});

export function packageInputErrors(
    error: z.ZodError,
): Record<string, string[]> {
    return Object.fromEntries(
        error.issues.map((issue) => [
            issue.path[0]?.toString() ?? '_form',
            [issue.message],
        ]),
    );
}

function refuse(field: string, message: string): never {
    throw new HttpFailure(422, {
        message: 'Periksa isian susunan module.',
        errors: { [field]: [message] },
    });
}

async function assertModulesInCatalog(db: Database, moduleIds: string[]) {
    const known = await db.rows(
        z.object({ id: z.string() }),
        'select id from catalog_modules where $1::text::jsonb ? id',
        [JSON.stringify(moduleIds)],
    );
    if (known.length !== moduleIds.length)
        refuse(
            'module_ids',
            'Ada module yang belum pernah dilaporkan host runtime mana pun.',
        );
}

async function writePackage(
    db: Database,
    statement: () => Promise<number>,
): Promise<void> {
    try {
        await db.transaction(async () => {
            if ((await statement()) === 0)
                throw new HttpFailure(404, {
                    error: 'package_not_found',
                    message:
                        'Susunan module tidak ditemukan atau sudah dihapus.',
                });
        });
    } catch (error) {
        if (sqlErrorCode(error) !== '23505') throw error;
        refuse('name', 'Nama ini sudah dipakai susunan module lain.');
    }
}

export async function listPackages(db: Database) {
    return db.rows(
        z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            modules: z.array(z.object({ id: z.string(), name: z.string() })),
        }),
        `select p.id, p.name, p.description,
            coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name) order by m.name)
                      from catalog_modules m where p.module_ids ? m.id), '[]') as modules
         from catalog_packages p where p.deleted_at is null order by p.name`,
    );
}

export async function createPackage(
    db: Database,
    actor: Actor,
    input: PackageInput,
): Promise<{ id: string }> {
    const id = Bun.randomUUIDv7();
    await db.transaction(async () => {
        await assertModulesInCatalog(db, input.module_ids);
        await writePackage(db, () =>
            db.execute(
                `insert into catalog_packages (id, name, description, module_ids, created_at, updated_at)
                 values ($1, $2, $3, $4::text::jsonb, ${now}, ${now})`,
                [
                    id,
                    input.name,
                    input.description,
                    JSON.stringify(input.module_ids),
                ],
            ),
        );
        await recordAudit(db, {
            ...actor,
            action: 'catalog.package_created',
            subjectType: 'catalog_package',
            subjectId: id,
            detail: { name: input.name, module_ids: input.module_ids },
        });
    });
    return { id };
}

export async function updatePackage(
    db: Database,
    actor: Actor,
    packageId: string,
    input: PackageInput,
): Promise<void> {
    await db.transaction(async () => {
        await assertModulesInCatalog(db, input.module_ids);
        await writePackage(db, () =>
            db.execute(
                `update catalog_packages set name = $2, description = $3, module_ids = $4::text::jsonb,
                    updated_at = ${now}
                 where id = $1 and deleted_at is null`,
                [
                    packageId,
                    input.name,
                    input.description,
                    JSON.stringify(input.module_ids),
                ],
            ),
        );
        await recordAudit(db, {
            ...actor,
            action: 'catalog.package_changed',
            subjectType: 'catalog_package',
            subjectId: packageId,
            detail: { name: input.name, module_ids: input.module_ids },
        });
    });
}

export async function deletePackage(
    db: Database,
    actor: Actor,
    packageId: string,
): Promise<void> {
    await db.transaction(async () => {
        await writePackage(db, () =>
            db.execute(
                `update catalog_packages set deleted_at = ${now}, updated_at = ${now}
                 where id = $1 and deleted_at is null`,
                [packageId],
            ),
        );
        await recordAudit(db, {
            ...actor,
            action: 'catalog.package_deleted',
            subjectType: 'catalog_package',
            subjectId: packageId,
        });
    });
}

// Memberi setiap module dalam susunan yang belum dimiliki tenant, dengan tanggal berakhir yang sama. Module yang sudah
// dimiliki tidak diubah, termasuk tanggal berakhirnya.
export async function grantPackage(
    db: Database,
    actor: Actor,
    tenantId: string,
    grant: z.infer<typeof packageGrantSchema>,
): Promise<{ granted: string[] }> {
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
        const pack = await db.one(
            z.object({ name: z.string(), module_ids: z.array(z.string()) }),
            'select name, module_ids from catalog_packages where id = $1 and deleted_at is null',
            [grant.package_id],
        );
        if (!pack)
            refuse(
                'package_id',
                'Susunan module ini tidak ada atau sudah dihapus.',
            );
        if (grant.ends_on !== null) {
            const past = await db.one(
                z.object({ past: z.boolean() }),
                `select $1::date < (${now})::date as past`,
                [grant.ends_on],
            );
            if (past?.past)
                refuse(
                    'ends_on',
                    'Tanggal berakhir tidak boleh sebelum hari ini.',
                );
        }
        const granted: string[] = [];
        for (const moduleId of pack.module_ids) {
            const inserted = await db.execute(
                `insert into tenant_module_entitlements (id, tenant_id, module_id, ends_on, created_at, updated_at)
                 select $1::uuid, $2::uuid, $3::varchar, $4::date, ${now}, ${now}
                 where not exists (select 1 from tenant_module_entitlements
                                   where tenant_id = $2::uuid and module_id = $3::varchar and deleted_at is null)`,
                [Bun.randomUUIDv7(), tenantId, moduleId, grant.ends_on],
            );
            if (inserted) granted.push(moduleId);
        }
        await recordAudit(db, {
            ...actor,
            action: 'tenant.package_entitled',
            subjectType: 'tenant',
            subjectId: tenantId,
            detail: {
                package_id: grant.package_id,
                package_name: pack.name,
                granted,
                ends_on: grant.ends_on,
            },
        });
        return { granted };
    });
}
