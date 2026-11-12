import { z } from 'zod';
import { recordAudit } from '../../audit/index.ts';
import type { Database } from '../../database/index.ts';
import { HttpFailure } from '../../http/index.ts';
import { type Operator, operatorSchema } from '../operator.service.ts';

type Actor = { operatorId: string; ipAddress: string };
type Identity = { issuer: string; subject: string };

const linkedSchema = operatorSchema.extend({ two_factor: z.boolean() });

// Operator yang tertaut ke identitas ini. Login SSO tidak pernah membuat operator.
export async function findLinkedOperator(
    db: Database,
    identity: Identity,
): Promise<{ operator: Operator; twoFactor: boolean } | null> {
    const row = await db.one(
        linkedSchema,
        `select o.id, o.name, o.email, o.two_factor_confirmed_at is not null as two_factor
         from operator_identities i join operators o on o.id = i.operator_id
         where i.issuer = $1 and i.subject = $2 and i.deleted_at is null and o.deleted_at is null`,
        [identity.issuer, identity.subject],
    );
    if (!row) return null;
    const { two_factor, ...operator } = row;
    return { operator, twoFactor: two_factor };
}

// Operator ini sudah tertaut ke penerbit SSO yang sedang dipakai konsol.
export async function isLinked(
    db: Database,
    operatorId: string,
    issuer: string,
): Promise<boolean> {
    const row = await db.one(
        z.object({ linked: z.boolean() }),
        `select exists (select 1 from operator_identities
                        where operator_id = $1 and issuer = $2 and deleted_at is null) as linked`,
        [operatorId, issuer],
    );
    return row?.linked ?? false;
}

export async function linkIdentity(
    db: Database,
    actor: Actor,
    identity: Identity & { email: string | null },
): Promise<void> {
    await db.transaction(async () => {
        // Operator yang memulai upacara bisa saja sudah dihapus selama sepuluh menit upacara berjalan.
        const active = await db.one(
            z.object({ id: z.string() }),
            'select id from operators where id = $1 and deleted_at is null for update',
            [actor.operatorId],
        );
        if (!active)
            throw new HttpFailure(401, { message: 'Unauthenticated.' });
        const taken = await db.one(
            z.object({ operator_id: z.string() }),
            `select operator_id from operator_identities
             where deleted_at is null and ((issuer = $1 and subject = $2) or (issuer = $1 and operator_id = $3))
             for update`,
            [identity.issuer, identity.subject, actor.operatorId],
        );
        if (taken)
            throw new HttpFailure(409, {
                message:
                    taken.operator_id === actor.operatorId
                        ? 'Akun ini sudah tertaut ke SSO. Lepaskan tautannya lebih dulu.'
                        : 'Akun SSO ini sudah tertaut ke operator lain.',
            });
        await db.execute(
            `insert into operator_identities (id, operator_id, issuer, subject, email_at_link, created_at, updated_at)
             values ($1, $2, $3, $4, $5, now() at time zone 'utc', now() at time zone 'utc')`,
            [
                Bun.randomUUIDv7(),
                actor.operatorId,
                identity.issuer,
                identity.subject,
                identity.email,
            ],
        );
        await recordAudit(db, {
            ...actor,
            action: 'sso.link',
            subjectType: 'operator',
            subjectId: actor.operatorId,
            detail: { issuer: identity.issuer, email_at_link: identity.email },
        });
    });
}

export async function unlinkIdentity(
    db: Database,
    actor: Actor,
    issuer: string,
): Promise<void> {
    await db.transaction(async () => {
        // Operator tanpa password hanya bisa masuk lewat SSO; melepas tautannya mengunci ia keluar dari konsol.
        const operator = await db.one(
            z.object({ has_password: z.boolean() }),
            'select password is not null as has_password from operators where id = $1 for update',
            [actor.operatorId],
        );
        if (!operator?.has_password)
            throw new HttpFailure(409, {
                message:
                    'Akun ini hanya bisa masuk lewat SSO, jadi tautannya tidak bisa dilepas.',
            });
        const removed = await db.execute(
            `update operator_identities set deleted_at = now() at time zone 'utc', updated_at = now() at time zone 'utc'
             where operator_id = $1 and issuer = $2 and deleted_at is null`,
            [actor.operatorId, issuer],
        );
        if (!removed)
            throw new HttpFailure(409, {
                message: 'Akun ini belum tertaut ke SSO.',
            });
        await recordAudit(db, {
            ...actor,
            action: 'sso.unlink',
            subjectType: 'operator',
            subjectId: actor.operatorId,
            detail: { issuer },
        });
    });
}
