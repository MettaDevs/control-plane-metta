import { z } from 'zod';
import { recordAudit } from '../../audit/index.ts';
import type { Config, SsoSettings } from '../../config/index.ts';
import type { Database } from '../../database/index.ts';
import { HttpFailure } from '../../http/index.ts';
import {
    hashInvitationToken,
    type InvitationInput,
    invitationDays,
    newInvitationToken,
    sendInvitationEmail,
} from '../../oidc/index.ts';
import { insertOperator, type Operator } from '../operator.service.ts';
import { findLinkedOperator, linkIdentity } from '../sso/sso.service.ts';

type Actor = { operatorId: string; ipAddress: string | null };

const now = "now() at time zone 'utc'";
const iso = (column: string) =>
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const usable = (alias: string) =>
    `${alias}.accepted_at is null and ${alias}.deleted_at is null and ${alias}.expires_at > ${now}`;

const notFound = () =>
    new HttpFailure(404, {
        error: 'invitation_not_found',
        message:
            'Undangan tidak ditemukan, sudah dipakai, atau sudah dibatalkan.',
    });

// Penyedia SSO hanya menerima tautan undangan yang host-nya terdaftar di klien pemanggil, jadi undangan operator
// dikirim dengan klien SSO konsol dan tautannya ada di host konsol. Tanpa SSO konsol, penerima juga tidak bisa masuk.
function ssoOf(config: Config): SsoSettings {
    if (!config.sso)
        throw new HttpFailure(409, {
            error: 'sso_not_configured',
            message:
                'SSO konsol belum disetel di server ini (CONSOLE_SSO_*), jadi operator belum bisa diundang.',
        });
    return config.sso;
}

export type OperatorInvitationSent = {
    id: string;
    accept_url: string;
    expires_at: string;
    // null berarti email terkirim; selain itu sebab gagalnya. Tautan tetap berlaku dan bisa dikirim ulang.
    email_failure: string | null;
};

const invitationRowSchema = z.object({
    recipient_email: z.string(),
    recipient_name: z.string().nullable(),
    expires_at: z.string(),
    invited_by: z.string(),
});

// Token baru setiap kali dikirim: yang tersimpan hanya hash-nya, jadi kirim ulang berarti tautan lama tidak berlaku
// lagi.
async function issueAndSend(
    db: Database,
    config: Config,
    invitationId: string,
    rotate: (
        tokenHash: string,
    ) => Promise<z.infer<typeof invitationRowSchema> | null>,
): Promise<OperatorInvitationSent> {
    const sso = ssoOf(config);
    const { token, hash } = newInvitationToken();
    const invitation = await rotate(hash);
    if (!invitation) throw notFound();
    const acceptUrl = `${new URL(sso.redirectUri).origin}/invitation?token=${token}`;
    const failure = await sendInvitationEmail(sso, 'CONSOLE_SSO', {
        recipientEmail: invitation.recipient_email,
        recipientName: invitation.recipient_name,
        acceptUrl,
        expiresInDays: invitationDays,
        invitedBy: invitation.invited_by,
        appName: 'Konsol operator',
        roleName: 'Operator',
    });
    if (failure === null)
        await db.execute(
            `update operator_invitations set notified_at = ${now}, updated_at = ${now} where id = $1`,
            [invitationId],
        );
    else
        process.stderr.write(
            JSON.stringify({
                event: 'operator-invitation-email-failed',
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

const emailTaken = (message: string) =>
    new HttpFailure(422, {
        message: 'Periksa isian undangan.',
        errors: { recipient_email: [message] },
    });

export async function inviteOperator(
    db: Database,
    config: Config,
    actor: Actor,
    input: InvitationInput,
): Promise<OperatorInvitationSent> {
    ssoOf(config);
    const id = Bun.randomUUIDv7();
    return issueAndSend(db, config, id, (tokenHash) =>
        db.transaction(async () => {
            const existing = await db.one(
                z.object({ kind: z.enum(['operator', 'invitation']) }),
                `select 'operator' as kind from operators where lower(email) = $1 and deleted_at is null
                 union all
                 select 'invitation' from operator_invitations
                 where lower(recipient_email) = $1 and accepted_at is null and deleted_at is null
                 limit 1`,
                [input.recipient_email],
            );
            if (existing?.kind === 'operator')
                throw emailTaken('Email ini sudah dipakai operator.');
            if (existing?.kind === 'invitation')
                throw emailTaken(
                    'Email ini sudah punya undangan yang belum dipakai. Kirim ulang undangan itu dari daftar.',
                );
            const row = await db.one(
                invitationRowSchema,
                `with created as (
                    insert into operator_invitations
                        (id, token_hash, recipient_email, recipient_name, expires_at, created_by, created_at,
                         updated_at)
                    values ($1, $2, $3, $4, ${now} + make_interval(days => $5), $6, ${now}, ${now})
                    returning recipient_email, recipient_name, expires_at, created_by
                 )
                 select c.recipient_email, c.recipient_name, ${iso('c.expires_at')} as expires_at, o.name as invited_by
                 from created c join operators o on o.id = c.created_by`,
                [
                    id,
                    tokenHash,
                    input.recipient_email,
                    input.recipient_name,
                    invitationDays,
                    actor.operatorId,
                ],
            );
            await recordAudit(db, {
                ...actor,
                action: 'operator.invited',
                subjectType: 'operator_invitation',
                subjectId: id,
                detail: { recipient_email: input.recipient_email },
            });
            return row ?? null;
        }),
    );
}

export async function resendOperatorInvitation(
    db: Database,
    config: Config,
    actor: Actor,
    invitationId: string,
): Promise<OperatorInvitationSent> {
    ssoOf(config);
    return issueAndSend(db, config, invitationId, (tokenHash) =>
        db.transaction(async () => {
            const row = await db.one(
                invitationRowSchema,
                `with rotated as (
                    update operator_invitations
                    set token_hash = $2, expires_at = ${now} + make_interval(days => $3), notified_at = null,
                        updated_at = ${now}
                    where id = $1 and accepted_at is null and deleted_at is null
                    returning recipient_email, recipient_name, expires_at
                 )
                 select r.recipient_email, r.recipient_name, ${iso('r.expires_at')} as expires_at,
                    o.name as invited_by
                 from rotated r join operators o on o.id = $4`,
                [invitationId, tokenHash, invitationDays, actor.operatorId],
            );
            if (!row) return null;
            await recordAudit(db, {
                ...actor,
                action: 'operator.invitation_resent',
                subjectType: 'operator_invitation',
                subjectId: invitationId,
                detail: { recipient_email: row.recipient_email },
            });
            return row;
        }),
    );
}

export async function cancelOperatorInvitation(
    db: Database,
    actor: Actor,
    invitationId: string,
): Promise<void> {
    await db.transaction(async () => {
        const row = await db.one(
            z.object({ recipient_email: z.string() }),
            `update operator_invitations set deleted_at = ${now}, updated_at = ${now}
             where id = $1 and accepted_at is null and deleted_at is null
             returning recipient_email`,
            [invitationId],
        );
        if (!row) throw notFound();
        await recordAudit(db, {
            ...actor,
            action: 'operator.invitation_cancelled',
            subjectType: 'operator_invitation',
            subjectId: invitationId,
            detail: { recipient_email: row.recipient_email },
        });
    });
}

// Operator dan undangan yang belum dipakai dalam satu daftar. Undangan yang kedaluwarsa ikut tampil supaya bisa
// dikirim ulang.
export async function listOperators(db: Database, issuer: string | null) {
    return db.rows(
        z.object({
            kind: z.enum(['operator', 'invitation']),
            id: z.string(),
            name: z.string().nullable(),
            email: z.string(),
            sso_linked: z.boolean(),
            created_at: z.string(),
            expires_at: z.string().nullable(),
            notified: z.boolean(),
            expired: z.boolean(),
        }),
        `select 'operator' as kind, o.id, o.name, o.email,
            exists (select 1 from operator_identities i
                    where i.operator_id = o.id and i.issuer = $1 and i.deleted_at is null) as sso_linked,
            ${iso('o.created_at')} as created_at, null as expires_at, true as notified, false as expired
         from operators o where o.deleted_at is null
         union all
         select 'invitation', i.id, i.recipient_name, i.recipient_email, false, ${iso('i.created_at')},
            ${iso('i.expires_at')}, i.notified_at is not null, i.expires_at <= ${now}
         from operator_invitations i where i.accepted_at is null and i.deleted_at is null
         order by kind desc, created_at`,
        [issuer],
    );
}

// Undangan yang tautannya dipegang browser ini: siapa yang mengundang, dan apakah tautannya masih bisa dipakai. null
// bila token tidak dikenal, termasuk token lama yang sudah diganti kirim ulang.
export async function findOperatorInvitation(
    db: Database,
    token: string,
): Promise<{ invited_by: string; usable: boolean } | null> {
    const row = await db.one(
        z.object({ invited_by: z.string(), usable: z.boolean() }),
        `select o.name as invited_by, (${usable('i')}) as usable
         from operator_invitations i join operators o on o.id = i.created_by
         where i.token_hash = $1`,
        [hashInvitationToken(token)],
    );
    return row ?? null;
}

// Hash token undangan yang masih bisa dipakai, untuk disimpan di upacara SSO sebelum browser dibawa ke penyedia.
export async function usableOperatorInvitationHash(
    db: Database,
    token: string,
): Promise<string | null> {
    const tokenHash = hashInvitationToken(token);
    const row = await db.one(
        z.object({ id: z.string() }),
        `select i.id from operator_invitations i where i.token_hash = $1 and ${usable('i')}`,
        [tokenHash],
    );
    return row ? tokenHash : null;
}

export type AcceptResult =
    | { status: 'accepted'; operator: Operator; twoFactor: boolean }
    | { status: 'invalid' }
    | { status: 'email-taken' };

// Menerima undangan dengan akun SSO yang baru saja login. Yang membuktikan hak adalah tautan undangan yang sampai ke
// kotak masuk penerima, jadi akun SSO tidak pernah ditautkan ke operator yang ada hanya karena emailnya sama. Undangan
// dikunci dan diperiksa ulang di dalam transaksi, karena tautan yang sama bisa dibuka dua kali bersamaan.
export async function acceptOperatorInvitation(
    db: Database,
    tokenHash: string,
    identity: {
        issuer: string;
        subject: string;
        name: string | null;
        email: string | null;
    },
    ipAddress: string,
): Promise<AcceptResult> {
    return db.transaction(async (): Promise<AcceptResult> => {
        const invitation = await db.one(
            z.object({
                id: z.string(),
                recipient_email: z.string(),
                recipient_name: z.string().nullable(),
                created_by: z.string(),
            }),
            `select i.id, i.recipient_email, i.recipient_name, i.created_by from operator_invitations i
             where i.token_hash = $1 and ${usable('i')}
             for update`,
            [tokenHash],
        );
        if (!invitation) return { status: 'invalid' };
        const accept = async (operatorId: string, created: boolean) => {
            await db.execute(
                `update operator_invitations set accepted_at = ${now}, accepted_operator_id = $2, updated_at = ${now}
                 where id = $1`,
                [invitation.id, operatorId],
            );
            await recordAudit(db, {
                operatorId,
                ipAddress,
                action: 'operator.invitation_accepted',
                subjectType: 'operator_invitation',
                subjectId: invitation.id,
                detail: { created, invited_by: invitation.created_by },
            });
        };

        // Akun SSO yang sudah tertaut ke operator tidak melahirkan operator kedua; undangannya selesai dan ia masuk
        // sebagai operator itu.
        const linked = await findLinkedOperator(db, identity);
        if (linked) {
            await accept(linked.operator.id, false);
            return { status: 'accepted', ...linked };
        }

        // Email dari akun SSO bila belum dipakai operator lain, selain itu email undangan, yang diperiksa saat
        // mengundang tetapi bisa saja sudah dipakai operator dari CLI sesudahnya.
        const candidates = [
            identity.email?.toLowerCase(),
            invitation.recipient_email,
        ].filter(
            (email): email is string => Boolean(email) && email!.length <= 255,
        );
        const taken = await db.rows(
            z.object({ email: z.string() }),
            `select lower(email) as email from operators
             where lower(email) in ($1, $2) and deleted_at is null`,
            [candidates[0]!, candidates.at(-1)!],
        );
        const email = candidates.find(
            (candidate) => !taken.some((row) => row.email === candidate),
        );
        if (!email) return { status: 'email-taken' };
        const operator = await insertOperator(
            db,
            {
                name: (
                    identity.name?.trim() ||
                    invitation.recipient_name ||
                    email
                ).slice(0, 255),
                email,
                password: null,
            },
            { operatorId: invitation.created_by, ipAddress },
            { invitation_id: invitation.id },
        );
        await linkIdentity(
            db,
            { operatorId: operator.id, ipAddress },
            {
                issuer: identity.issuer,
                subject: identity.subject,
                email: identity.email,
            },
        );
        await accept(operator.id, true);
        return { status: 'accepted', operator, twoFactor: false };
    });
}
