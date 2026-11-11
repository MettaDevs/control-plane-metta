import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { loadConfig } from '../../../../src/platform/config/index.ts';
import {
    createPool,
    Database,
} from '../../../../src/platform/database/index.ts';
import { createApplication } from '../../../../src/platform/http/index.ts';
import { OidcStub } from '../../../support/oidc-provider.ts';
import { operatorIdentityRoutes } from '../../../../src/platform/operator-identity/index.console.ts';
import { createOperator } from '../../../../src/platform/operator-identity/index.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('operator SSO', () => {
    if (!process.env.DB_HOST) return;
    let stub: OidcStub;
    let application: ReturnType<typeof createApplication>;
    let config: ReturnType<typeof loadConfig>;
    const pool = createPool(
        loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 6).toString('base64'),
        }),
    );
    const email = `sso-${crypto.randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    const subject = `subject-${crypto.randomUUID()}`;

    beforeAll(async () => {
        stub = await OidcStub.start();
        config = loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 6).toString('base64'),
            SESSION_SECURE_COOKIE: 'false',
            CONSOLE_SSO_ISSUER: stub.issuer,
            CONSOLE_SSO_CLIENT_ID: stub.clientId,
            CONSOLE_SSO_CLIENT_SECRET: stub.clientSecret,
            CONSOLE_SSO_REDIRECT_URI: stub.redirectUri,
        });
        application = createApplication(config, operatorIdentityRoutes(config));
    });
    afterAll(async () => {
        stub.stop();
        await application.close();
        await pool.end();
    });

    const call = (
        path: string,
        init: {
            method?: string;
            body?: string;
            cookie?: string;
            type?: string;
        } = {},
    ) =>
        application.handle(
            new Request(`http://localhost${path}`, {
                method: init.method ?? 'GET',
                headers: {
                    'content-type': init.type ?? 'application/json',
                    ...(init.cookie ? { cookie: init.cookie } : {}),
                },
                body: init.body,
            }),
            '203.0.113.20',
        );
    const cookieOf = (response: Response, name: string) =>
        response.headers
            .getSetCookie()
            .find(
                (cookie) =>
                    cookie.startsWith(`${name}=`) &&
                    !cookie.startsWith(`${name}=;`),
            );
    const value = (cookie: string | undefined) => cookie?.split(';')[0] ?? '';
    const target = async (response: Response) =>
        /url=([^"]+)"/
            .exec(await response.text())?.[1]
            ?.replaceAll('&amp;', '&');
    const ceremonyName = () => `${config.SESSION_COOKIE}_sso`;

    // Menjalankan satu upacara: browser kembali dari penyedia dengan kode untuk klaim ini.
    async function returnFromProvider(
        authorizeUrl: string,
        ceremony: string,
        claims: Record<string, unknown>,
    ) {
        const state = new URL(authorizeUrl).searchParams.get('state');
        const code = stub.grant(authorizeUrl, claims);
        return call(`/sso/callback?code=${code}&state=${state}`, {
            cookie: ceremony,
        });
    }

    async function ssoLogin(claims: Record<string, unknown>) {
        const start = await call('/sso/start');
        expect(start.status).toBe(302);
        const ceremony = cookieOf(start, ceremonyName())!;
        expect(ceremony).toContain('SameSite=Lax');
        expect(ceremony).toContain('Path=/sso');
        return returnFromProvider(
            start.headers.get('location')!,
            value(ceremony),
            claims,
        );
    }

    test('links an account, logs in with it, and ends sessions on back-channel logout', async () => {
        const db = new Database(pool);
        const operator = await createOperator(
            db,
            { name: 'Operator SSO', email, password },
            { operatorId: null, ipAddress: null },
        );

        // Akun SSO yang belum tertaut tidak pernah membuat operator.
        const unlinked = await ssoLogin(stub.idClaims({ sub: subject }));
        expect(await target(unlinked)).toBe('/login?sso_error=not-linked');
        expect(cookieOf(unlinked, config.SESSION_COOKIE)).toBeUndefined();

        const login = await call('/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        const session = value(cookieOf(login, config.SESSION_COOKIE));
        expect(
            (
                await call('/api/v1/sso/link', {
                    method: 'POST',
                    body: JSON.stringify({ password: 'wrong password' }),
                    cookie: session,
                })
            ).status,
        ).toBe(422);
        const link = await call('/api/v1/sso/link', {
            method: 'POST',
            body: JSON.stringify({ password }),
            cookie: session,
        });
        expect(link.status).toBe(200);
        const { authorize_url } = (await link.json()) as {
            authorize_url: string;
        };
        const linked = await returnFromProvider(
            authorize_url,
            value(cookieOf(link, ceremonyName())),
            stub.idClaims({ sub: subject, email: 'someone@example.com' }),
        );
        expect(await target(linked)).toBe('/?sso=linked');

        // State yang tidak cocok dengan cookie upacara ditolak.
        const start = await call('/sso/start');
        const ceremony = value(cookieOf(start, ceremonyName()));
        const wrongState = await call(`/sso/callback?code=x&state=other`, {
            cookie: ceremony,
        });
        expect(await target(wrongState)).toBe(
            '/login?sso_error=invalid-ceremony',
        );

        const viaSso = await ssoLogin(stub.idClaims({ sub: subject }));
        expect(await target(viaSso)).toBe('/');
        const ssoSession = value(cookieOf(viaSso, config.SESSION_COOKIE));
        const me = await call('/api/v1/me', { cookie: ssoSession });
        expect(me.status).toBe(200);
        expect(await me.json()).toMatchObject({
            operator: { id: operator.id },
            sso: { linked: true },
        });

        const logoutToken = await stub.sign({
            ...stub.idClaims({ sub: subject }),
            jti: crypto.randomUUID(),
            events: {
                'http://schemas.openid.net/event/backchannel-logout': {},
            },
        });
        const backchannel = () =>
            call('/sso/backchannel-logout', {
                method: 'POST',
                type: 'application/x-www-form-urlencoded',
                body: new URLSearchParams({
                    logout_token: logoutToken,
                }).toString(),
            });
        expect((await backchannel()).status).toBe(200);
        expect((await call('/api/v1/me', { cookie: ssoSession })).status).toBe(
            401,
        );
        expect((await backchannel()).status).toBe(400);

        // 2FA yang aktif tetap diminta walau masuk lewat SSO.
        await db.execute(
            "update operators set two_factor_secret = 'sealed', two_factor_confirmed_at = now() where id = $1",
            [operator.id],
        );
        const withTwoFactor = await ssoLogin(stub.idClaims({ sub: subject }));
        expect(await target(withTwoFactor)).toBe('/login?two_factor=1');
        expect(cookieOf(withTwoFactor, config.SESSION_COOKIE)).toBeUndefined();
        expect(
            cookieOf(withTwoFactor, `${config.SESSION_COOKIE}_two_factor`),
        ).toBeDefined();
        await db.execute(
            'update operators set two_factor_secret = null, two_factor_confirmed_at = null where id = $1',
            [operator.id],
        );

        const again = value(
            cookieOf(
                await call('/login', {
                    method: 'POST',
                    body: JSON.stringify({ email, password }),
                }),
                config.SESSION_COOKIE,
            ),
        );
        expect(
            (
                await call('/api/v1/sso/link', {
                    method: 'DELETE',
                    body: '{}',
                    cookie: again,
                })
            ).status,
        ).toBe(204);
        expect(
            await target(await ssoLogin(stub.idClaims({ sub: subject }))),
        ).toBe('/login?sso_error=not-linked');

        const audit = await db.rows(
            z.object({
                action: z.string(),
                detail: z.record(z.string(), z.unknown()),
            }),
            'select action, detail from operator_audit_events where subject_id = $1 order by id',
            [operator.id],
        );
        await db.release();
        expect(audit).toEqual([
            { action: 'operator.created', detail: { email } },
            {
                action: 'sso.link',
                detail: {
                    issuer: stub.issuer,
                    email_at_link: 'someone@example.com',
                },
            },
            { action: 'sso.unlink', detail: { issuer: stub.issuer } },
        ]);
    });

    test('answers 404 on every SSO route when SSO is not configured', async () => {
        const plain = loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 6).toString('base64'),
        });
        const app = createApplication(plain, operatorIdentityRoutes(plain));
        try {
            for (const path of ['/sso/start', '/sso/callback?code=x&state=y'])
                expect(
                    (await app.handle(new Request(`http://localhost${path}`)))
                        .status,
                ).toBe(404);
        } finally {
            await app.close();
        }
    });
});
