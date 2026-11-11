import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import { recordAudit } from '../../platform/audit/index.ts';
import type { Database } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import { sendInvitationEmail } from './sso-invitation.ts';

type Actor = { operatorId: string; ipAddress: string | null };

const now = "now() at time zone 'utc'";
const iso = (column: string) =>
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export const invitationDays = 7;

export const invitationInputSchema = z.strictObject({
    recipient_email: z
        .email('Isi alamat email yang benar.')
        .max(255, 'Email paling panjang 255 karakter.')
        .toLowerCase(),
    recipient_name: z
        .string()
        .trim()
        .max(255, 'Nama paling panjang 255 karakter.')
        .nullable()
        .transform((value) => value || null),
});
export type InvitationInput = z.infer<typeof invitationInputSchema>;

export function invitationInputErrors(
    error: z.ZodError,
): Record<string, string[]> {
    return Object.fromEntries(
        error.issues.map((issue) => [
            issue.path.join('.') || '_form',
            [issue.message],
        ]),
    );
}

export function hashInvitationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

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

// Token baru setiap kali dikirim: yang tersimpan hanya hash-nya, jadi kirim ulang berarti tautan lama tidak berlaku
// lagi.
async function issueAndSend(
    db: Database,
    config: Config,
    invitationId: string,
    rotate: (tokenHash: string) => Promise<{
        recipient_email: string;
        recipient_name: string | null;
        expires_at: string;
        invited_by: string;
    } | null>,
): Promise<InvitationSent> {
    const portal = portalOf(config);
    const token = randomBytes(32).toString('base64url');
    const invitation = await rotate(hashInvitationToken(token));
    if (!invitation)
        throw new HttpFailure(404, {
            error: 'invitation_not_found',
            message:
                'Undangan tidak ditemukan, sudah dipakai, atau sudah dibatalkan.',
        });
    const acceptUrl = `${portal.url}/invitation?token=${token}`;
    const failure = await sendInvitationEmail(portal, {
        recipientEmail: invitation.recipient_email,
        recipientName: invitation.recipient_name,
        acceptUrl,
        expiresInDays: invitationDays,
        invitedBy: invitation.invited_by,
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

const invitationRowSchema = z.object({
    recipient_email: z.string(),
    recipient_name: z.string().nullable(),
    expires_at: z.string(),
    invited_by: z.string(),
});

export async function inviteToPortal(
    db: Database,
    config: Config,
    actor: Actor,
    clientId: string,
    input: InvitationInput,
): Promise<InvitationSent> {
    portalOf(config);
    const id = Bun.randomUUIDv7();
    return issueAndSend(db, config, id, (tokenHash) =>
        db.transaction(async () => {
            const client = await db.one(
                z.object({ id: z.string() }),
                'select id from clients where id = $1',
                [clientId],
            );
            if (!client)
                throw new HttpFailure(404, {
                    error: 'customer_not_found',
                    message: 'Customer tidak ditemukan.',
                });
            const row = await db.one(
                invitationRowSchema,
                `with created as (
                    insert into client_portal_invitations
                        (id, client_id, token_hash, recipient_email, recipient_name, expires_at, created_by,
                         created_at, updated_at)
                    values ($1, $2, $3, $4, $5, ${now} + make_interval(days => $6), $7, ${now}, ${now})
                    returning recipient_email, recipient_name, expires_at, created_by
                 )
                 select c.recipient_email, c.recipient_name, ${iso('c.expires_at')} as expires_at, o.name as invited_by
                 from created c join operators o on o.id = c.created_by`,
                [
                    id,
                    clientId,
                    tokenHash,
                    input.recipient_email,
                    input.recipient_name,
                    invitationDays,
                    actor.operatorId,
                ],
            );
            await recordAudit(db, {
                ...actor,
                action: 'customer.portal_invited',
                subjectType: 'client',
                subjectId: clientId,
                detail: {
                    invitation_id: id,
                    recipient_email: input.recipient_email,
                },
            });
            return row ?? null;
        }),
    );
}

export async function resendPortalInvitation(
    db: Database,
    config: Config,
    actor: Actor,
    invitationId: string,
): Promise<InvitationSent> {
    return issueAndSend(db, config, invitationId, (tokenHash) =>
        db.transaction(async () => {
            const row = await db.one(
                invitationRowSchema.extend({ client_id: z.string() }),
                `with rotated as (
                    update client_portal_invitations
                    set token_hash = $2, expires_at = ${now} + make_interval(days => $3), notified_at = null,
                        updated_at = ${now}
                    where id = $1 and accepted_at is null and deleted_at is null
                    returning client_id, recipient_email, recipient_name, expires_at
                 )
                 select r.client_id, r.recipient_email, r.recipient_name, ${iso('r.expires_at')} as expires_at,
                    o.name as invited_by
                 from rotated r join operators o on o.id = $4`,
                [invitationId, tokenHash, invitationDays, actor.operatorId],
            );
            if (!row) return null;
            await recordAudit(db, {
                ...actor,
                action: 'customer.portal_invitation_resent',
                subjectType: 'client',
                subjectId: row.client_id,
                detail: {
                    invitation_id: invitationId,
                    recipient_email: row.recipient_email,
                },
            });
            return row;
        }),
    );
}

export async function cancelPortalInvitation(
    db: Database,
    actor: Actor,
    invitationId: string,
): Promise<void> {
    await db.transaction(async () => {
        const row = await db.one(
            z.object({ client_id: z.string(), recipient_email: z.string() }),
            `update client_portal_invitations set deleted_at = ${now}, updated_at = ${now}
             where id = $1 and accepted_at is null and deleted_at is null
             returning client_id, recipient_email`,
            [invitationId],
        );
        if (!row)
            throw new HttpFailure(404, {
                error: 'invitation_not_found',
                message:
                    'Undangan tidak ditemukan, sudah dipakai, atau sudah dibatalkan.',
            });
        await recordAudit(db, {
            ...actor,
            action: 'customer.portal_invitation_cancelled',
            subjectType: 'client',
            subjectId: row.client_id,
            detail: {
                invitation_id: invitationId,
                recipient_email: row.recipient_email,
            },
        });
    });
}

export async function revokePortalUser(
    db: Database,
    actor: Actor,
    userId: string,
): Promise<void> {
    await db.transaction(async () => {
        const row = await db.one(
            z.object({
                client_id: z.string(),
                email_at_link: z.string().nullable(),
            }),
            `update client_portal_users set deleted_at = ${now}, updated_at = ${now}
             where id = $1 and deleted_at is null
             returning client_id, email_at_link`,
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
                email_at_link: row.email_at_link,
            },
        });
    });
}

// Siapa yang punya akses portal customer ini, dan undangan yang masih menunggu, dalam satu daftar. Undangan yang
// kedaluwarsa ikut tampil supaya operator bisa mengirim ulang.
export async function listPortalAccess(db: Database, clientId: string) {
    return db.rows(
        z.object({
            kind: z.enum(['user', 'invitation']),
            id: z.string(),
            name: z.string().nullable(),
            email: z.string().nullable(),
            since: z.string(),
            expires_at: z.string().nullable(),
            notified: z.boolean(),
            expired: z.boolean(),
        }),
        `select 'user' as kind, u.id, u.name_at_link as name, u.email_at_link as email, ${iso('u.created_at')} as since,
            null as expires_at, true as notified, false as expired
         from client_portal_users u where u.client_id = $1 and u.deleted_at is null
         union all
         select 'invitation', i.id, i.recipient_name, i.recipient_email, ${iso('i.created_at')}, ${iso('i.expires_at')},
            i.notified_at is not null, i.expires_at <= ${now}
         from client_portal_invitations i
         where i.client_id = $1 and i.accepted_at is null and i.deleted_at is null
         order by kind desc, since`,
        [clientId],
    );
}
