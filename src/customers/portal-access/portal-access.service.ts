import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import { recordAudit } from '../../platform/audit/index.ts';
import type { Database } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import {
    type InvitationInput,
    invitationDays,
    newInvitationToken,
    sendInvitationEmail,
} from '../../platform/oidc/index.ts';

// Pengundang: operator di konsol, atau admin portal tenant itu. Jejak audit tindakan dari portal ditulis tanpa
// operator, dengan pengguna portalnya di detail.
export type PortalUserActor = {
    id: string;
    tenantId: string;
    name: string | null;
    email: string | null;
};
export type Inviter =
    | { operatorId: string; ipAddress: string | null }
    | { portalUser: PortalUserActor; ipAddress: string | null };

// admin: dikirim otomatis saat customer dibuat; penerimanya ditautkan ke admin pertama klinik. member: pengguna klinik
// baru tanpa role, yang role-nya diberi admin klinik di dalam klinik.
export type InvitationKind = 'admin' | 'member';

function auditActor(inviter: Inviter) {
    return 'operatorId' in inviter
        ? { operatorId: inviter.operatorId, ipAddress: inviter.ipAddress }
        : { operatorId: null, ipAddress: inviter.ipAddress };
}

function auditDetail(inviter: Inviter): Record<string, unknown> {
    return 'portalUser' in inviter
        ? {
              portal_user_id: inviter.portalUser.id,
              portal_user_name: inviter.portalUser.name,
              portal_user_email: inviter.portalUser.email,
          }
        : {};
}

// Undangan dari portal hanya menyentuh tenant pengundangnya; operator boleh menyentuh undangan tenant mana pun.
function tenantScope(inviter: Inviter): string | null {
    return 'portalUser' in inviter ? inviter.portalUser.tenantId : null;
}

async function inviterName(db: Database, inviter: Inviter): Promise<string> {
    if ('portalUser' in inviter)
        return (
            inviter.portalUser.name ??
            inviter.portalUser.email ??
            'Admin klinik'
        );
    const operator = await db.one(
        z.object({ name: z.string() }),
        'select name from operators where id = $1',
        [inviter.operatorId],
    );
    return operator?.name ?? 'Operator';
}

const roleNames = {
    admin: 'Admin klinik',
    member: 'Anggota klinik',
} as const satisfies Record<InvitationKind, string>;

const now = "now() at time zone 'utc'";
const iso = (column: string) =>
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

function portalOf(config: Config) {
    if (!config.portal)
        throw new HttpFailure(409, {
            error: 'portal_not_configured',
            message:
                'Portal klien belum disetel di server ini (PORTAL_URL dan PORTAL_SSO_*), jadi undangan belum bisa dibuat.',
        });
    return config.portal;
}

export type InvitationSent = {
    id: string;
    accept_url: string;
    expires_at: string;
    // null berarti email terkirim; selain itu sebab gagalnya. Tautan tetap berlaku dan bisa dikirim ulang.
    email_failure: string | null;
};

const invitationRowSchema = z.object({
    recipient_email: z.string(),
    recipient_name: z.string().nullable(),
    kind: z.enum(['admin', 'member']),
    expires_at: z.string(),
});
type InvitationRow = z.infer<typeof invitationRowSchema>;

const notFound = () =>
    new HttpFailure(404, {
        error: 'invitation_not_found',
        message:
            'Undangan tidak ditemukan, sudah dipakai, atau sudah dibatalkan.',
    });

// Token baru setiap kali dikirim: yang tersimpan hanya hash-nya, jadi kirim ulang berarti tautan lama tidak berlaku
// lagi.
async function issueAndSend(
    db: Database,
    config: Config,
    inviter: Inviter,
    invitationId: string,
    rotate: (tokenHash: string) => Promise<InvitationRow | null>,
): Promise<InvitationSent> {
    const portal = portalOf(config);
    const { token, hash } = newInvitationToken();
    const invitation = await rotate(hash);
    if (!invitation) throw notFound();
    const acceptUrl = `${portal.url}/invitation?token=${token}`;
    const failure = await sendInvitationEmail(portal.sso, 'PORTAL_SSO', {
        recipientEmail: invitation.recipient_email,
        recipientName: invitation.recipient_name,
        acceptUrl,
        expiresInDays: invitationDays,
        invitedBy: await inviterName(db, inviter),
        appName: 'Portal klien',
        roleName: roleNames[invitation.kind],
    });
    if (failure === null)
        await db.execute(
            `update client_portal_invitations set notified_at = ${now}, updated_at = ${now} where id = $1`,
            [invitationId],
        );
    else
        process.stderr.write(
            JSON.stringify({
                event: 'portal-invitation-email-failed',
                invitation_id: invitationId,
                message: failure,
            }) + '\n',
        );
    return {
        id: invitationId,
        accept_url: acceptUrl,
        expires_at: invitation.expires_at,
        email_failure: failure,
    };
}

// Undangan ke satu tenant milik customer clientId. Tenant yang bukan milik customer itu dijawab 404.
export async function inviteToPortal(
    db: Database,
    config: Config,
    inviter: Inviter,
    target: { clientId: string; tenantId: string; kind: InvitationKind },
    input: InvitationInput,
): Promise<InvitationSent> {
    portalOf(config);
    const id = Bun.randomUUIDv7();
    return issueAndSend(db, config, inviter, id, (tokenHash) =>
        db.transaction(async () => {
            const tenant = await db.one(
                z.object({ id: z.string() }),
                'select id from tenants where id = $1 and client_id = $2',
                [target.tenantId, target.clientId],
            );
            if (!tenant)
                throw new HttpFailure(404, {
                    error: 'tenant_not_found',
                    message: 'Klinik ini tidak ditemukan pada customer ini.',
                });
            const row = await db.one(
                invitationRowSchema,
                `insert into client_portal_invitations
                    (id, client_id, tenant_id, kind, token_hash, recipient_email, recipient_name, expires_at,
                     created_by, invited_by_portal_user_id, created_at, updated_at)
                 values ($1, $2, $3, $4, $5, $6, $7, ${now} + make_interval(days => $8), $9, $10, ${now}, ${now})
                 returning recipient_email, recipient_name, kind, ${iso('expires_at')} as expires_at`,
                [
                    id,
                    target.clientId,
                    target.tenantId,
                    target.kind,
                    tokenHash,
                    input.recipient_email,
                    input.recipient_name,
                    invitationDays,
                    'operatorId' in inviter ? inviter.operatorId : null,
                    'portalUser' in inviter ? inviter.portalUser.id : null,
                ],
            );
            await recordAudit(db, {
                ...auditActor(inviter),
                action: 'customer.portal_invited',
                subjectType: 'client',
                subjectId: target.clientId,
                detail: {
                    invitation_id: id,
                    tenant_id: target.tenantId,
                    kind: target.kind,
                    recipient_email: input.recipient_email,
                    ...auditDetail(inviter),
                },
            });
            return row ?? null;
        }),
    );
}

export async function resendPortalInvitation(
    db: Database,
    config: Config,
    inviter: Inviter,
    invitationId: string,
): Promise<InvitationSent> {
    return issueAndSend(db, config, inviter, invitationId, (tokenHash) =>
        db.transaction(async () => {
            const row = await db.one(
                invitationRowSchema.extend({
                    client_id: z.string(),
                    tenant_id: z.string(),
                }),
                `update client_portal_invitations
                 set token_hash = $2, expires_at = ${now} + make_interval(days => $3), notified_at = null,
                    updated_at = ${now}
                 where id = $1 and accepted_at is null and deleted_at is null
                   and ($4::uuid is null or tenant_id = $4::uuid)
                 returning client_id, tenant_id, recipient_email, recipient_name, kind,
                    ${iso('expires_at')} as expires_at`,
                [invitationId, tokenHash, invitationDays, tenantScope(inviter)],
            );
            if (!row) return null;
            await recordAudit(db, {
                ...auditActor(inviter),
                action: 'customer.portal_invitation_resent',
                subjectType: 'client',
                subjectId: row.client_id,
                detail: {
                    invitation_id: invitationId,
                    tenant_id: row.tenant_id,
                    recipient_email: row.recipient_email,
                    ...auditDetail(inviter),
                },
            });
            return row;
        }),
    );
}

export async function cancelPortalInvitation(
    db: Database,
    inviter: Inviter,
    invitationId: string,
): Promise<void> {
    await db.transaction(async () => {
        const row = await db.one(
            z.object({
                client_id: z.string(),
                tenant_id: z.string(),
                recipient_email: z.string(),
            }),
            `update client_portal_invitations set deleted_at = ${now}, updated_at = ${now}
             where id = $1 and accepted_at is null and deleted_at is null
               and ($2::uuid is null or tenant_id = $2::uuid)
             returning client_id, tenant_id, recipient_email`,
            [invitationId, tenantScope(inviter)],
        );
        if (!row) throw notFound();
        await recordAudit(db, {
            ...auditActor(inviter),
            action: 'customer.portal_invitation_cancelled',
            subjectType: 'client',
            subjectId: row.client_id,
            detail: {
                invitation_id: invitationId,
                tenant_id: row.tenant_id,
                recipient_email: row.recipient_email,
                ...auditDetail(inviter),
            },
        });
    });
}

// Mencabut akses portal tidak menyentuh akun SSO yang sudah ditautkan ke pengguna klinik (tenant_identities): akses ke
// klinik diatur di dalam klinik sendiri.
export async function revokePortalUser(
    db: Database,
    actor: { operatorId: string; ipAddress: string | null },
    userId: string,
): Promise<void> {
    await db.transaction(async () => {
        const row = await db.one(
            z.object({
                client_id: z.string(),
                tenant_id: z.string(),
                email_at_link: z.string().nullable(),
            }),
            `update client_portal_users set deleted_at = ${now}, updated_at = ${now}
             where id = $1 and deleted_at is null
             returning client_id, tenant_id, email_at_link`,
            [userId],
        );
        if (!row)
            throw new HttpFailure(404, {
                error: 'portal_user_not_found',
                message: 'Akses portal ini tidak ditemukan atau sudah dicabut.',
            });
        await recordAudit(db, {
            ...actor,
            action: 'customer.portal_access_revoked',
            subjectType: 'client',
            subjectId: row.client_id,
            detail: {
                portal_user_id: userId,
                tenant_id: row.tenant_id,
                email_at_link: row.email_at_link,
            },
        });
    });
}

const accessRowSchema = z.object({
    kind: z.enum(['user', 'invitation']),
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    tenant_id: z.string(),
    tenant_name: z.string(),
    // Pemegang akses admin atau penerima undangan admin: boleh mengundang anggota ke tenant itu.
    admin: z.boolean(),
    since: z.string(),
    expires_at: z.string().nullable(),
    notified: z.boolean(),
    expired: z.boolean(),
});

// Siapa yang punya akses portal, dan undangan yang masih menunggu, dalam satu daftar, untuk satu customer atau satu
// tenant. Undangan yang kedaluwarsa ikut tampil supaya bisa dikirim ulang.
function listAccess(
    db: Database,
    column: 'client_id' | 'tenant_id',
    id: string,
) {
    return db.rows(
        accessRowSchema,
        `select 'user' as kind, u.id, u.name_at_link as name, u.email_at_link as email, u.tenant_id,
            t.name as tenant_name, u.is_admin as admin, ${iso('u.created_at')} as since, null as expires_at,
            true as notified, false as expired
         from client_portal_users u join tenants t on t.id = u.tenant_id
         where u.${column} = $1 and u.deleted_at is null
         union all
         select 'invitation', i.id, i.recipient_name, i.recipient_email, i.tenant_id, t.name, i.kind = 'admin',
            ${iso('i.created_at')}, ${iso('i.expires_at')}, i.notified_at is not null, i.expires_at <= ${now}
         from client_portal_invitations i join tenants t on t.id = i.tenant_id
         where i.${column} = $1 and i.accepted_at is null and i.deleted_at is null
         order by kind desc, since`,
        [id],
    );
}

export function listPortalAccess(db: Database, clientId: string) {
    return listAccess(db, 'client_id', clientId);
}

export function listTenantMembers(db: Database, tenantId: string) {
    return listAccess(db, 'tenant_id', tenantId);
}
