import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { Database } from '../../../../src/platform/database/index.ts';
import { createOperator } from '../../../../src/platform/operator-identity/index.ts';
import {
    codeAt,
    stepAt,
} from '../../../../src/platform/operator-identity/two-factor/totp.ts';
import { consoleTestApp } from '../../../support/console-app.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('operator two-factor', () => {
    if (!process.env.DB_HOST) return;
    const { config, pool, call, cookieOf, sessionOf, close } =
        consoleTestApp(3);
    const password = 'correct horse battery staple';
    afterAll(close);

    test('turns on 2FA, asks for it at login, and turns it off', async () => {
        const db = new Database(pool);
        const twoFactorEmail = `two-factor-${crypto.randomUUID()}@example.com`;
        const operator = await createOperator(
            db,
            { name: 'Operator 2FA', email: twoFactorEmail, password },
            { operatorId: null, ipAddress: null },
        );
        const sessionName = config.SESSION_COOKIE;
        const pendingName = `${sessionName}_two_factor`;
        const login = () =>
            call('/login', {
                method: 'POST',
                body: { email: twoFactorEmail, password },
            });
        let cookie = sessionOf(await login());

        expect(
            (
                await call('/api/v1/two-factor', {
                    method: 'POST',
                    body: { password: 'wrong password' },
                    cookie,
                })
            ).status,
        ).toBe(422);
        const started = await call('/api/v1/two-factor', {
            method: 'POST',
            body: { password },
            cookie,
        });
        expect(started.status).toBe(200);
        const { secret, otpauth_uri } = (await started.json()) as {
            secret: string;
            otpauth_uri: string;
        };
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(otpauth_uri).toStartWith(
            `otpauth://totp/localhost%3A${encodeURIComponent(twoFactorEmail)}?secret=${secret}&issuer=localhost`,
        );

        const step = stepAt(Date.now());
        const valid = [step - 1, step, step + 1].map((at) =>
            codeAt(secret, at),
        );
        const wrong = ['000000', '111111', '222222'].find(
            (code) => !valid.includes(code),
        );
        expect(
            (
                await call('/api/v1/two-factor/confirm', {
                    method: 'POST',
                    body: { code: wrong },
                    cookie,
                })
            ).status,
        ).toBe(422);
        const confirmed = await call('/api/v1/two-factor/confirm', {
            method: 'POST',
            body: { code: codeAt(secret, step) },
            cookie,
        });
        expect(confirmed.status).toBe(200);
        const { recovery_codes } = (await confirmed.json()) as {
            recovery_codes: string[];
        };
        expect(recovery_codes).toHaveLength(8);
        expect(
            await (await call('/api/v1/me', { cookie })).json(),
        ).toMatchObject({ two_factor_enabled: true });

        // Password benar hanya memberi cookie tunggu, dan cookie itu tidak diterima sebagai sesi.
        const first = await login();
        expect(await first.json()).toEqual({ two_factor_required: true });
        expect(cookieOf(first, sessionName)).toBeUndefined();
        const pending = cookieOf(first, pendingName)!;
        expect(
            (
                await call('/api/v1/me', {
                    cookie: pending.replace(
                        `${pendingName}=`,
                        `${sessionName}=`,
                    ),
                })
            ).status,
        ).toBe(401);
        expect(
            (
                await call('/login/two-factor', {
                    method: 'POST',
                    body: { code: codeAt(secret, step + 1) },
                })
            ).status,
        ).toBe(401);
        // Kode yang sudah dipakai untuk konfirmasi tidak diterima lagi.
        expect(
            (
                await call('/login/two-factor', {
                    method: 'POST',
                    body: { code: codeAt(secret, step) },
                    cookie: pending,
                })
            ).status,
        ).toBe(422);
        const verified = await call('/login/two-factor', {
            method: 'POST',
            body: { code: codeAt(secret, step + 1) },
            cookie: pending,
        });
        expect(verified.status).toBe(200);
        expect(await verified.json()).toEqual({ operator });
        expect(cookieOf(verified, pendingName)).toBe(`${pendingName}=`);
        cookie = cookieOf(verified, sessionName)!;
        expect((await call('/api/v1/me', { cookie })).status).toBe(200);

        // Kode pemulihan berlaku sekali.
        for (const expected of [200, 422]) {
            const again = cookieOf(await login(), pendingName)!;
            const recovered = await call('/login/two-factor', {
                method: 'POST',
                body: { code: recovery_codes[0] },
                cookie: again,
            });
            expect(recovered.status).toBe(expected);
        }

        expect(
            (
                await call('/api/v1/two-factor', {
                    method: 'DELETE',
                    body: { password },
                    cookie,
                })
            ).status,
        ).toBe(204);
        expect(await (await login()).json()).toEqual({ operator });

        const actions = await db.rows(
            z.object({ action: z.string() }),
            'select action from operator_audit_events where subject_id = $1 order by id',
            [operator.id],
        );
        await db.release();
        expect(actions.map((row) => row.action)).toEqual([
            'operator.created',
            'operator.two_factor_enabled',
            'operator.two_factor_disabled',
        ]);
    });
});
