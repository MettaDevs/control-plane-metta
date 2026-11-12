import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import type { Database } from '../../platform/database/index.ts';
import { hashInvitationToken } from '../../platform/oidc/index.ts';

// Identitas SSO pemegang akses portal. Akses selalu dicari lewat pasangan iss dan sub, tidak pernah lewat email.
export type PortalIdentity = { issuer: string; subject: string };

const now = "now() at time zone 'utc'";
const usable = (alias: string) =>
    `${alias}.accepted_at is null and ${alias}.deleted_at is null and ${alias}.expires_at > ${now}`;

// Undangan yang tautannya dipegang browser ini: nama customer, dan apakah tautannya masih bisa dipakai. null bila
// token tidak dikenal, termasuk token lama yang sudah diganti kirim ulang.
export async function findInvitation(
    db: Database,
    token: string,
): Promise<{ legal_name: string; usable: boolean } | null> {
    const row = await db.one(
        z.object({ legal_name: z.string(), usable: z.boolean() }),
        `select c.legal_name, (${usable('i')}) as usable
         from client_portal_invitations i join clients c on c.id = i.client_id
         where i.token_hash = $1`,
        [hashInvitationToken(token)],
    );
    return row ?? null;
}

// Hash token undangan yang masih bisa dipakai, untuk disimpan di upacara SSO sebelum browser dibawa ke penyedia.
export async function usableInvitationHash(
    db: Database,
    token: string,
): Promise<string | null> {
    const tokenHash = hashInvitationToken(token);
    const row = await db.one(
        z.object({ id: z.string() }),
        `select i.id from client_portal_invitations i where i.token_hash = $1 and ${usable('i')}`,
        [tokenHash],
    );
    return row ? tokenHash : null;
}

/// Menautkan identitas SSO ke tenant undangan. Yang membuktikan hak adalah tautan undangan yang sampai ke kotak masuk
// penerima, jadi email akun SSO tidak pernah dicocokkan. Undangan dikunci dan diperiksa ulang di dalam transaksi,
// karena tautan yang sama bisa dibuka dua kali bersamaan. false bila undangan sudah tidak bisa dipakai.
//
// Di transaksi yang sama identitas ini dicatat di tenant_identities untuk ditautkan worker ke pengguna klinik:
// undangan admin ke admin pertama klinik, undangan member ke pengguna klinik baru tanpa role. Admin pertama yang sudah
// tertaut ke akun SSO lain tidak ditautkan dua kali; identitas ini lalu mendapat pengguna klinik baru.
export async function acceptInvitation(
    db: Database,
    tokenHash: string,
    identity: PortalIdentity & { name: string | null; email: string | null },
    ipAddress: string,
): Promise<boolean> {
    return db.transaction(async () => {
        const invitation = await db.one(
            z.object({
                id: z.string(),
                client_id: z.string(),
                tenant_id: z.string(),
                kind: z.enum(['admin', 'member']),
            }),
            `select i.id, i.client_id, i.tenant_id, i.kind from client_portal_invitations i
             where i.token_hash = $1 and ${usable('i')}
             for update`,
            [tokenHash],
        );
        if (!invitation) return false;
        // Dua undangan admin tenant yang sama yang diterima bersamaan berebut admin pertama yang sama.
        const tenant = await db.one(
            z.object({ first_admin_user_id: z.string().nullable() }),
            'select first_admin_user_id from tenants where id = $1 for update',
            [invitation.tenant_id],
        );
        const admin = invitation.kind === 'admin';
        // Identitas yang sudah memegang akses hidup ke tenant ini tidak mendapat baris kedua; undangan admin
        // menjadikannya admin.
        const linked = await db.one(
            z.object({ id: z.string() }),
            `insert into client_portal_users
                (id, client_id, tenant_id, issuer, subject, name_at_link, email_at_link, invitation_id, is_admin,
                 created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${now}, ${now})
             on conflict (tenant_id, issuer, subject) where deleted_at is null
             do update set is_admin = client_portal_users.is_admin or excluded.is_admin, updated_at = ${now}
             returning id`,
            [
                Bun.randomUUIDv7(),
                invitation.client_id,
                invitation.tenant_id,
                identity.issuer,
                identity.subject,
                identity.name,
                identity.email,
                invitation.id,
                admin,
            ],
        );
        let userId: string | null = null;
        if (admin && tenant?.first_admin_user_id) {
            const holder = await db.one(
                z.object({ id: z.string() }),
                `select id from tenant_identities where tenant_id = $1 and user_id = $2 and deleted_at is null`,
                [invitation.tenant_id, tenant.first_admin_user_id],
            );
            if (!holder) userId = tenant.first_admin_user_id;
        }
        // Identitas yang sudah tertaut di tenant ini tetap pada tautannya: worker hanya menambah, tidak memindah.
        const identityId = await db.one(
            z.object({ id: z.string() }),
            `insert into tenant_identities (id, tenant_id, issuer, subject, email, name, user_id, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, ${now}, ${now})
             on conflict (tenant_id, issuer, subject) where deleted_at is null do nothing
             returning id`,
            [
                Bun.randomUUIDv7(),
                invitation.tenant_id,
                identity.issuer,
                identity.subject,
                identity.email,
                identity.name,
                userId,
            ],
        );
        await db.execute(
            `update client_portal_invitations set accepted_at = ${now}, updated_at = ${now} where id = $1`,
            [invitation.id],
        );
        await recordAudit(db, {
            operatorId: null,
            ipAddress,
            action: 'customer.portal_invitation_accepted',
            subjectType: 'client',
            subjectId: invitation.client_id,
            detail: {
                invitation_id: invitation.id,
                tenant_id: invitation.tenant_id,
                kind: invitation.kind,
                portal_user_id: linked?.id ?? null,
                tenant_identity_id: identityId?.id ?? null,
                linked_user_id: identityId ? userId : null,
                email_at_link: identity.email,
            },
        });
        return true;
    });
}

// Identitas ini masih memegang akses hidup, dan sesi yang terbit pada issuedAt (milidetik) belum dicabut logout.
export async function hasLiveAccess(
    db: Database,
    identity: PortalIdentity,
    issuedAt: number = Date.now(),
): Promise<boolean> {
    const row = await db.one(
        z.object({ live: z.boolean() }),
        `select count(*) > 0
                and bool_and(sessions_valid_after is null
                             or sessions_valid_after < to_timestamp($3::double precision / 1000)) as live
         from client_portal_users where issuer = $1 and subject = $2 and deleted_at is null`,
        [identity.issuer, identity.subject, issuedAt],
    );
    return row?.live ?? false;
}

// Mengakhiri semua sesi portal identitas ini, termasuk di perangkat lain.
export async function revokePortalSessions(
    db: Database,
    identity: PortalIdentity,
    at: number,
): Promise<void> {
    await db.execute(
        `update client_portal_users set sessions_valid_after = to_timestamp($3::double precision / 1000)
         where issuer = $1 and subject = $2 and deleted_at is null`,
        [identity.issuer, identity.subject, at],
    );
}

/// Akses identitas ini ke satu tenant: pengguna portal pemegangnya, customer tenant itu, dan apakah ia admin.
const tenantAccessSchema = z.object({
    portal_user_id: z.string(),
    tenant_id: z.string(),
    client_id: z.string(),
    is_admin: z.boolean(),
    name_at_link: z.string().nullable(),
    email_at_link: z.string().nullable(),
});
export type TenantAccess = z.infer<typeof tenantAccessSchema>;

// Tenant aktif sesi ini: tenant pilihan (dari cookie) bila identitas ini masih memegang aksesnya, selain itu tenant
// pertama yang bisa dibukanya, urut nama customer lalu nama tenant. null bila tidak ada akses hidup sama sekali.
export async function activeTenant(
    db: Database,
    identity: PortalIdentity,
    preferredTenantId: string | null,
): Promise<TenantAccess | null> {
    const row = await db.one(
        tenantAccessSchema,
        `select u.id as portal_user_id, u.tenant_id, t.client_id, u.is_admin, u.name_at_link, u.email_at_link
         from client_portal_users u join tenants t on t.id = u.tenant_id join clients c on c.id = t.client_id
         where u.issuer = $1 and u.subject = $2 and u.deleted_at is null
         order by coalesce(u.tenant_id::text = $3, false) desc, c.legal_name, t.name, t.id
         limit 1`,
        [identity.issuer, identity.subject, preferredTenantId],
    );
    return row ?? null;
}

// Identitas ini memegang akses hidup ke tenant itu.
export async function canAccessTenant(
    db: Database,
    identity: PortalIdentity,
    tenantId: string,
): Promise<boolean> {
    const row = await db.one(
        z.object({ id: z.string() }),
        `select id from client_portal_users
         where issuer = $1 and subject = $2 and tenant_id = $3 and deleted_at is null`,
        [identity.issuer, identity.subject, tenantId],
    );
    return row !== undefined;
}

// Nama dan email dari tautan terakhir, serta setiap tenant yang bisa dibuka identitas ini beserta customernya.
export async function portalAccount(db: Database, identity: PortalIdentity) {
    const rows = await db.rows(
        z.object({
            tenant_id: z.string(),
            tenant_name: z.string(),
            client_id: z.string(),
            legal_name: z.string(),
            is_admin: z.boolean(),
            name_at_link: z.string().nullable(),
            email_at_link: z.string().nullable(),
            linked_at: z.string(),
        }),
        // Urutan sama dengan activeTenant, supaya tenant bawaan adalah yang pertama di daftar.
        `select t.id as tenant_id, t.name as tenant_name, c.id as client_id, c.legal_name, u.is_admin, u.name_at_link,
            u.email_at_link, to_char(u.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as linked_at
         from client_portal_users u join tenants t on t.id = u.tenant_id join clients c on c.id = t.client_id
         where u.issuer = $1 and u.subject = $2 and u.deleted_at is null
         order by c.legal_name, t.name, t.id`,
        [identity.issuer, identity.subject],
    );
    const latest = rows.toSorted((left, right) =>
        right.linked_at.localeCompare(left.linked_at),
    );
    return {
        name: latest.find((row) => row.name_at_link)?.name_at_link ?? null,
        email: latest.find((row) => row.email_at_link)?.email_at_link ?? null,
        tenants: rows.map((row) => ({
            id: row.tenant_id,
            name: row.tenant_name,
            client_id: row.client_id,
            legal_name: row.legal_name,
            is_admin: row.is_admin,
        })),
    };
}
