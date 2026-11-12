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

// Menautkan identitas SSO ke customer pemilik undangan. Yang membuktikan hak adalah tautan undangan yang sampai ke
// kotak masuk penerima, jadi email akun SSO tidak pernah dicocokkan. Undangan dikunci dan diperiksa ulang di dalam
// transaksi, karena tautan yang sama bisa dibuka dua kali bersamaan. false bila undangan sudah tidak bisa dipakai.
export async function acceptInvitation(
    db: Database,
    tokenHash: string,
    identity: PortalIdentity & { name: string | null; email: string | null },
    ipAddress: string,
): Promise<boolean> {
    return db.transaction(async () => {
        const invitation = await db.one(
            z.object({ id: z.string(), client_id: z.string() }),
            `select i.id, i.client_id from client_portal_invitations i where i.token_hash = $1 and ${usable('i')}
             for update`,
            [tokenHash],
        );
        if (!invitation) return false;
        // Identitas yang sudah memegang akses hidup ke customer ini tidak mendapat baris kedua.
        const linked = await db.one(
            z.object({ id: z.string() }),
            `insert into client_portal_users
                (id, client_id, issuer, subject, name_at_link, email_at_link, invitation_id, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, ${now}, ${now})
             on conflict (client_id, issuer, subject) where deleted_at is null do nothing
             returning id`,
            [
                Bun.randomUUIDv7(),
                invitation.client_id,
                identity.issuer,
                identity.subject,
                identity.name,
                identity.email,
                invitation.id,
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
                portal_user_id: linked?.id ?? null,
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

// Nama dan email dari tautan terakhir, serta setiap customer yang bisa dibuka identitas ini.
export async function portalAccount(db: Database, identity: PortalIdentity) {
    const rows = await db.rows(
        z.object({
            client_id: z.string(),
            legal_name: z.string(),
            name_at_link: z.string().nullable(),
            email_at_link: z.string().nullable(),
        }),
        `select c.id as client_id, c.legal_name, u.name_at_link, u.email_at_link
         from client_portal_users u join clients c on c.id = u.client_id
         where u.issuer = $1 and u.subject = $2 and u.deleted_at is null
         order by u.created_at desc`,
        [identity.issuer, identity.subject],
    );
    return {
        name: rows.find((row) => row.name_at_link)?.name_at_link ?? null,
        email: rows.find((row) => row.email_at_link)?.email_at_link ?? null,
        customers: rows
            .map(({ client_id, legal_name }) => ({ client_id, legal_name }))
            .sort((left, right) =>
                left.legal_name.localeCompare(right.legal_name),
            ),
    };
}
