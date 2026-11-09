import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { Database } from '../../../../src/platform/database/index.ts';
import { createOperator } from '../../../../src/platform/operator-identity/index.ts';
import { consoleTestApp } from '../../../support/console-app.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('operator login', () => {
    if (!process.env.DB_HOST) return;
    const { pool, call, sessionOf, close } = consoleTestApp(3);
    const email = `operator-${crypto.randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    afterAll(close);

    test('logs in, reads itself, and logs out every session', async () => {
        const db = new Database(pool);
        const operator = await createOperator(
            db,
            { name: 'Operator Uji', email, password },
            { operatorId: null, ipAddress: null },
        );
        const audit = await db.one(
            z.object({ action: z.string() }),
            'select action from operator_audit_events where subject_id = $1',
            [operator.id],
        );
        await db.release();
        expect(audit?.action).toBe('operator.created');

        expect((await call('/api/v1/me')).status).toBe(401);

        const login = await call('/login', {
            method: 'POST',
            body: { email: email.toUpperCase(), password },
        });
        expect(login.status).toBe(200);
        expect(await login.json()).toEqual({ operator });
        const cookie = sessionOf(login);
        expect(login.headers.getSetCookie()[0]).toContain('SameSite=Strict');

        const me = await call('/api/v1/me', { cookie });
        expect(me.status).toBe(200);
        expect(await me.json()).toEqual({
            operator,
            two_factor_enabled: false,
        });

        const logout = await call('/logout', {
            method: 'POST',
            body: {},
            cookie,
        });
        expect(logout.status).toBe(204);
        expect(logout.headers.getSetCookie()[0]).toContain('Max-Age=0');
        expect((await call('/api/v1/me', { cookie })).status).toBe(401);

        const again = await call('/login', {
            method: 'POST',
            body: { email, password },
        });
        expect(again.status).toBe(200);
        expect(
            (await call('/api/v1/me', { cookie: sessionOf(again) })).status,
        ).toBe(200);
    });

    test('refuses forms, then throttles wrong passwords', async () => {
        const form = await call('/login', {
            method: 'POST',
            type: 'application/x-www-form-urlencoded',
            body: { email, password },
        });
        expect(form.status).toBe(415);

        for (let attempt = 0; attempt < 5; attempt++) {
            const wrong = await call('/login', {
                method: 'POST',
                body: { email, password: 'wrong password' },
            });
            expect(wrong.status).toBe(422);
        }
        const blocked = await call('/login', {
            method: 'POST',
            body: { email, password },
        });
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    });
});
