import { z } from 'zod';
import { environmentAddress } from '../../environments/index.ts';
import type { Database } from '../../platform/database/index.ts';
import {
    environmentKindSchema,
    environmentStatusSchema,
} from '../customer/customer.service.ts';

const tenantSchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    legal_name: z.string(),
    environments: z.array(
        z.object({
            id: z.string(),
            kind: environmentKindSchema,
            name: z.string(),
            status: environmentStatusSchema,
            expires_at: z.string().nullable(),
        }),
    ),
    // Hak memakai module yang masih hidup; yang dicabut tidak tampil.
    modules: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            ends_on: z.string().nullable(),
        }),
    ),
});

// Tenant aktif sesi portal, dengan lingkungan hidup dan module-nya. Id tenant datang dari sesi yang aksesnya sudah
// diperiksa, tidak pernah dari permintaan.
export async function listPortalEnvironments(
    db: Database,
    tenantId: string,
    operationsUrl: string | undefined,
) {
    const tenant = await db.one(
        tenantSchema,
        `select t.id, t.name, t.slug, c.legal_name,
            coalesce((select json_agg(json_build_object(
                'id', e.id, 'kind', e.kind, 'name', e.name, 'status', e.status,
                'expires_at', to_char(e.expires_at, 'YYYY-MM-DD')) order by e.created_at)
                from environments e where e.tenant_id = t.id and e.deleted_at is null), '[]') as environments,
            coalesce((select json_agg(json_build_object(
                'id', m.module_id, 'name', cm.name, 'ends_on', to_char(m.ends_on, 'YYYY-MM-DD'))
                order by cm.name, m.module_id)
                from tenant_module_entitlements m join catalog_modules cm on cm.id = m.module_id
                where m.tenant_id = t.id and m.deleted_at is null), '[]') as modules
         from tenants t join clients c on c.id = t.client_id
         where t.id = $1`,
        [tenantId],
    );
    if (!tenant) throw new Error(`Tenant aktif ${tenantId} tidak ditemukan.`);
    return {
        ...tenant,
        environments: tenant.environments.map((environment) => ({
            ...environment,
            address: environmentAddress(
                operationsUrl,
                tenant.slug,
                environment.kind,
            ),
        })),
    };
}
