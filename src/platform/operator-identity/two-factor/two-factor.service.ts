import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../../audit/index.ts';
import type { Database } from '../../database/index.ts';
import { HttpFailure } from '../../http/index.ts';
import type { SecretBox } from '../secret-box.ts';
import { matchingStep, newSecret } from './totp.ts';

type Actor = { operatorId: string; ipAddress: string };

const recoveryCount = 8;
const recoveryAlphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// Bentuk kode pemulihan sama dengan Fortify: dua potong sepuluh karakter acak.
function recoveryCodes(): string[] {
    const part = () =>
        Array.from(
            { length: 10 },
            () => recoveryAlphabet[randomInt(recoveryAlphabet.length)],
        ).join('');
    return Array.from({ length: recoveryCount }, () => `${part()}-${part()}`);
}

const stateSchema = z.object({
    secret: z.string().nullable(),
    recovery: z.string().nullable(),
    confirmed: z.boolean(),
    last_step: z.coerce.number().nullable(),
});

async function lockState(db: Database, operatorId: string) {
    const state = await db.one(
        stateSchema,
        `select two_factor_secret as secret, two_factor_recovery_codes as recovery,
                two_factor_confirmed_at is not null as confirmed, two_factor_last_step as last_step
         from operators where id = $1 and deleted_at is null for update`,
        [operatorId],
    );
    if (!state) throw new HttpFailure(401, { message: 'Unauthenticated.' });
    return state;
}

export async function startEnrollment(
    db: Database,
    box: SecretBox,
    operatorId: string,
): Promise<string> {
    return db.transaction(async () => {
        if ((await lockState(db, operatorId)).confirmed)
            throw new HttpFailure(409, {
                message: 'Verifikasi dua langkah sudah aktif.',
            });
        const secret = newSecret();
        await db.execute(
            `update operators set two_factor_secret = $2, two_factor_recovery_codes = null, two_factor_last_step = null,
                updated_at = now() at time zone 'utc'
             where id = $1`,
            [operatorId, box.seal(secret)],
        );
        return secret;
    });
}

export async function confirmEnrollment(
    db: Database,
    box: SecretBox,
    actor: Actor,
    code: string,
    now: number,
): Promise<string[]> {
    return db.transaction(async () => {
        const state = await lockState(db, actor.operatorId);
        if (state.confirmed)
            throw new HttpFailure(409, {
                message: 'Verifikasi dua langkah sudah aktif.',
            });
        if (!state.secret)
            throw new HttpFailure(409, {
                message: 'Mulai pendaftaran verifikasi dua langkah lebih dulu.',
            });
        const step = matchingStep(box.open(state.secret), code, now);
        if (step === null)
            throw new HttpFailure(422, {
                message: 'Kode tidak cocok.',
                errors: { code: ['Kode tidak cocok.'] },
            });
        const codes = recoveryCodes();
        await db.execute(
            `update operators set two_factor_recovery_codes = $2, two_factor_last_step = $3,
                two_factor_confirmed_at = now() at time zone 'utc', updated_at = now() at time zone 'utc'
             where id = $1`,
            [actor.operatorId, box.seal(JSON.stringify(codes)), step],
        );
        await recordAudit(db, {
            operatorId: actor.operatorId,
            action: 'operator.two_factor_enabled',
            subjectType: 'operator',
            subjectId: actor.operatorId,
            ipAddress: actor.ipAddress,
        });
        return codes;
    });
}

export async function disableTwoFactor(
    db: Database,
    actor: Actor,
): Promise<void> {
    await db.transaction(async () => {
        if (!(await lockState(db, actor.operatorId)).confirmed)
            throw new HttpFailure(409, {
                message: 'Verifikasi dua langkah belum aktif.',
            });
        await db.execute(
            `update operators set two_factor_secret = null, two_factor_recovery_codes = null,
                two_factor_confirmed_at = null, two_factor_last_step = null, updated_at = now() at time zone 'utc'
             where id = $1`,
            [actor.operatorId],
        );
        await recordAudit(db, {
            operatorId: actor.operatorId,
            action: 'operator.two_factor_disabled',
            subjectType: 'operator',
            subjectId: actor.operatorId,
            ipAddress: actor.ipAddress,
        });
    });
}

// Kode TOTP diterima sekali: langkahnya harus sesudah langkah terakhir yang diterima. Kode pemulihan dicoret dari
// daftar begitu dipakai. Baris operator dikunci, jadi dua request bersamaan tidak bisa memakai kode yang sama.
export async function verifySecondFactor(
    db: Database,
    box: SecretBox,
    operatorId: string,
    code: string,
    now: number,
): Promise<'totp' | 'recovery' | null> {
    return db.transaction(async () => {
        const state = await lockState(db, operatorId);
        if (!state.confirmed || !state.secret) return null;
        const step = matchingStep(box.open(state.secret), code.trim(), now);
        if (step !== null) {
            if (state.last_step !== null && step <= state.last_step)
                return null;
            await db.execute(
                'update operators set two_factor_last_step = $2 where id = $1',
                [operatorId, step],
            );
            return 'totp';
        }
        const codes = z
            .array(z.string())
            .parse(
                JSON.parse(state.recovery ? box.open(state.recovery) : '[]'),
            );
        const remaining = codes.filter((value) => value !== code.trim());
        if (remaining.length === codes.length) return null;
        await db.execute(
            'update operators set two_factor_recovery_codes = $2 where id = $1',
            [operatorId, box.seal(JSON.stringify(remaining))],
        );
        return 'recovery';
    });
}
