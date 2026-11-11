import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import {
    environmentKindSchema,
    environmentStatusSchema,
} from '../customer/customer.service.ts';
import type { PortalIdentity } from '../portal-access/portal-identity.service.ts';

const customerSchema = z.object({
    client_id: z.string(),
    legal_name: z.string(),
    tenants: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
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
        }),
    ),
});

// Setiap customer yang bisa dibuka identitas ini, dengan lingkungan hidup dan module setiap tenant-nya. Customer
// disaring lewat akses hidup identitas, tidak pernah lewat id dari permintaan.
export async function listPortalEnvironments(
    db: Database,
    identity: PortalIdentity,
) {
    return db.rows(
        customerSchema,
        `select c.id as client_id, c.legal_name,
            coalesce((select json_agg(json_build_object(
                'id', t.id, 'name', t.name,
                'environments', coalesce((select json_agg(json_build_object(
                    'id', e.id, 'kind', e.kind, 'name', e.name, 'status', e.status,
                    'expires_at', to_char(e.expires_at, 'YYYY-MM-DD')) order by e.created_at)
                    from environments e where e.tenant_id = t.id and e.deleted_at is null), '[]'),
                'modules', coalesce((select json_agg(json_build_object(
                    'id', m.module_id, 'name', cm.name, 'ends_on', to_char(m.ends_on, 'YYYY-MM-DD'))
                    order by cm.name, m.module_id)
                    from tenant_module_entitlements m join catalog_modules cm on cm.id = m.module_id
                    where m.tenant_id = t.id and m.deleted_at is null), '[]'))
                order by t.name, t.slug)
                from tenants t where t.client_id = c.id), '[]') as tenants
         from clients c
         where c.id in (select client_id from client_portal_users
                        where issuer = $1 and subject = $2 and deleted_at is null)
         order by c.legal_name`,
        [identity.issuer, identity.subject],
    );
}
