import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';
import { createCustomer } from '../../../src/customers/customer/customer.service.ts';
import { revokePortalUser } from '../../../src/customers/portal-access/portal-access.service.ts';
import { addRuntimeHost } from '../../../src/environments/index.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { hashInvitationToken } from '../../../src/platform/oidc/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { portalRouter } from '../../../src/portal.ts';
import { OidcStub } from '../../support/oidc-provider.ts';

const portalUrl = 'https://portal.example.test';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('portal klien lewat SSO', () => {
    if (!process.env.DB_HOST) return;
    let stub: OidcStub;
    let application: ReturnType<typeof createApplication>;
    let config: ReturnType<typeof loadConfig>;
    const pool = createPool(
        loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 41).toString('base64'),
        }),
    );
    const db = new Database(pool);

    beforeAll(async () => {
        stub = await OidcStub.start(`${portalUrl}/sso/callback`);
        config = loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 41).toString('base64'),
            SESSION_SECURE_COOKIE: 'false',
            PORTAL_URL: portalUrl,
            PORTAL_SSO_ISSUER: stub.issuer,
            PORTAL_SSO_CLIENT_ID: stub.clientId,
            PORTAL_SSO_CLIENT_SECRET: stub.clientSecret,
        });
        application = createApplication(
            config,
            portalRouter(config, config.portal!),
        );
    });
    afterAll(async () => {
        stub.stop();
        await application.close();
        await db.release();
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
            new Request(`${portalUrl}${path}`, {
                method: init.method ?? 'GET',
                headers: {
                    'content-type': init.type ?? 'application/json',
                    ...(init.cookie ? { cookie: init.cookie } : {}),
                },
                body: init.body,
            }),
            '203.0.113.41',
        );
    const sessionName = () => `${config.SESSION_COOKIE}_portal`;
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

    // Satu upacara SSO dari /sso/start sampai browser kembali dari penyedia dengan kode untuk klaim ini.
    async function signIn(
        claims: Record<string, unknown>,
        invitation?: string,
        beforeReturn?: () => Promise<void>,
    ) {
        const start = await call(
            invitation === undefined
                ? '/sso/start'
                : `/sso/start?invitation=${encodeURIComponent(invitation)}`,
        );
        if (start.status !== 302) return start;
        const ceremony = cookieOf(start, `${sessionName()}_sso`)!;
        expect(ceremony).toContain('SameSite=Lax');
        expect(ceremony).toContain('Path=/sso');
        const authorizeUrl = start.headers.get('location')!;
        const state = new URL(authorizeUrl).searchParams.get('state');
        const code = stub.grant(authorizeUrl, claims);
        await beforeReturn?.();
        return call(`/sso/callback?code=${code}&state=${state}`, {
            cookie: value(ceremony),
        });
    }

    async function setup() {
        const operator = await createOperator(
            db,
            {
                name: 'Operator Undangan',
                email: `portal-sso-${crypto.randomUUID()}@example.com`,
                password: 'correct horse battery staple',
            },
            { operatorId: null, ipAddress: null },
        );
        const host = await addRuntimeHost(db, {
            name: `host-portal-sso-${crypto.randomUUID()}`,
            public_key: generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            }).publicKey,
        });
        await db.execute(
            "update runtime_hosts set reported_at = now() at time zone 'utc' where id = $1",
            [host.id],
        );
        const actor = { operatorId: operator.id, ipAddress: null };
        const customer = async (legalName: string) =>
            (
                await createCustomer(db, actor, crypto.randomUUID(), {
                    legal_name: legalName,
                    slug: `sso-${crypto.randomUUID().slice(-12)}`,
                    admin: { name: 'Admin', email: 'admin@klinik.test' },
                    environment: { kind: 'production', name: 'Produksi' },
                })
            ).client_id;
        return { actor, customer };
    }

    // Undangan langsung di database: tokennya dipegang test, seperti penerima memegang tautan di email.
    async function invite(
        clientId: string,
        operatorId: string,
        state: { expired?: boolean; cancelled?: boolean } = {},
    ) {
        const token = crypto.randomUUID();
        await db.execute(
            `insert into client_portal_invitations
                (id, client_id, tenant_id, kind, token_hash, recipient_email, expires_at, created_by, deleted_at,
                 created_at, updated_at)
             values ($1, $2, (select id from tenants where client_id = $2), 'member', $3, 'penerima@klinik.test',
                     now() at time zone 'utc' + make_interval(days => $4), $5,
                     case when $6 then now() at time zone 'utc' end, now(), now())`,
            [
                Bun.randomUUIDv7(),
                clientId,
                hashInvitationToken(token),
                state.expired ? -1 : 7,
                operatorId,
                state.cancelled === true,
            ],
        );
        return token;
    }

    const portalUsers = async (clientId: string) => [
        ...(await pool.unsafe(
            `select id, subject, name_at_link, email_at_link from client_portal_users
             where client_id = $1 and deleted_at is null`,
            [clientId],
        )),
    ];

    test('menerima undangan menautkan akun SSO, lalu login berikutnya tanpa undangan', async () => {
        const { actor, customer } = await setup();
        const clientId = await customer('Klinik Undangan Sehat');
        const subject = `subject-${crypto.randomUUID()}`;
        const token = await invite(clientId, actor.operatorId);

        const page = await call(
            `/api/v1/invitation?token=${encodeURIComponent(token)}`,
        );
        expect(await page.json()).toEqual({
            legal_name: 'Klinik Undangan Sehat',
            usable: true,
        });

        // Email akun SSO berbeda dari email undangan: yang membuktikan adalah tautannya.
        const accepted = await signIn(
            stub.idClaims({
                sub: subject,
                name: 'Kepala Klinik',
                email: 'akun-lain@contoh.test',
            }),
            token,
        );
        expect(await target(accepted)).toBe('/');
        const session = value(cookieOf(accepted, sessionName()));
        expect(session).not.toBe('');
        expect(await portalUsers(clientId)).toEqual([
            expect.objectContaining({
                subject,
                name_at_link: 'Kepala Klinik',
                email_at_link: 'akun-lain@contoh.test',
            }),
        ]);

        const me = await call('/api/v1/me', { cookie: session });
        expect(me.status).toBe(200);
        const tenantId = z
            .string()
            .parse(
                (
                    await pool.unsafe(
                        'select id from tenants where client_id = $1',
                        [clientId],
                    )
                )[0]?.id,
            );
        expect(await me.json()).toEqual({
            name: 'Kepala Klinik',
            email: 'akun-lain@contoh.test',
            tenants: [
                {
                    id: tenantId,
                    name: 'Klinik Undangan Sehat',
                    client_id: clientId,
                    legal_name: 'Klinik Undangan Sehat',
                    is_admin: false,
                },
            ],
            active_tenant_id: tenantId,
        });

        // Tautan yang sudah dipakai tidak bisa dipakai lagi, juga oleh akun yang sama.
        expect(
            await (
                await call(
                    `/api/v1/invitation?token=${encodeURIComponent(token)}`,
                )
            ).json(),
        ).toEqual({ legal_name: 'Klinik Undangan Sehat', usable: false });
        expect(
            await target(await signIn(stub.idClaims({ sub: subject }), token)),
        ).toBe('/login?portal_error=invitation-invalid');

        const login = await signIn(stub.idClaims({ sub: subject }));
        expect(await target(login)).toBe('/');
        expect(
            (
                await call('/api/v1/me', {
                    cookie: value(cookieOf(login, sessionName())),
                })
            ).status,
        ).toBe(200);
    });

    test('undangan yang kedaluwarsa, dibatalkan, atau dibatalkan selama login ditolak', async () => {
        const { actor, customer } = await setup();
        const clientId = await customer('Klinik Undangan Lewat');
        const subject = `subject-${crypto.randomUUID()}`;
        const claims = stub.idClaims({ sub: subject });

        const expired = await invite(clientId, actor.operatorId, {
            expired: true,
        });
        const cancelled = await invite(clientId, actor.operatorId, {
            cancelled: true,
        });
        for (const token of [expired, cancelled, 'tidak-dikenal']) {
            const start = await call(
                `/sso/start?invitation=${encodeURIComponent(token)}`,
            );
            expect(start.status).toBe(200);
            expect(await target(start)).toBe(
                '/login?portal_error=invitation-invalid',
            );
        }
        expect(
            (await call('/api/v1/invitation?token=tidak-dikenal')).status,
        ).toBe(404);

        // Undangan diperiksa ulang di callback: pembatalan selama upacara berjalan tetap menang.
        const token = await invite(clientId, actor.operatorId);
        const response = await signIn(claims, token, async () => {
            await db.execute(
                `update client_portal_invitations set deleted_at = now() at time zone 'utc'
                 where token_hash = $1`,
                [hashInvitationToken(token)],
            );
        });
        expect(await target(response)).toBe(
            '/login?portal_error=invitation-invalid',
        );
        expect(cookieOf(response, sessionName())).toBeUndefined();
        expect(await portalUsers(clientId)).toEqual([]);
    });

    test('akun SSO tanpa akses ditolak, dan setiap customer hanya terlihat oleh pemegang aksesnya', async () => {
        const { actor, customer } = await setup();
        const own = await customer('Klinik Milik Sendiri');
        const other = await customer('Klinik Orang Lain');
        const subject = `subject-${crypto.randomUUID()}`;

        const unlinked = await signIn(stub.idClaims({ sub: subject }));
        expect(await target(unlinked)).toBe('/login?portal_error=not-linked');
        expect(cookieOf(unlinked, sessionName())).toBeUndefined();
        expect((await call('/api/v1/environments')).status).toBe(401);

        const session = value(
            cookieOf(
                await signIn(
                    stub.idClaims({ sub: subject }),
                    await invite(own, actor.operatorId),
                ),
                sessionName(),
            ),
        );
        const listed = await call('/api/v1/environments', { cookie: session });
        expect(listed.status).toBe(200);
        const body = z
            .object({
                tenant: z.object({
                    legal_name: z.string(),
                    environments: z.array(
                        z.object({
                            kind: z.string(),
                            name: z.string(),
                        }),
                    ),
                    modules: z.array(z.unknown()),
                }),
            })
            .parse(await listed.json());
        expect(body.tenant.legal_name).toBe('Klinik Milik Sendiri');
        expect(body.tenant.environments).toEqual([
            expect.objectContaining({ kind: 'production', name: 'Produksi' }),
        ]);
        expect(JSON.stringify(body)).not.toContain(other);
    });

    test('akses yang dicabut, logout, dan back-channel logout mengakhiri sesi', async () => {
        const { actor, customer } = await setup();
        const clientId = await customer('Klinik Dicabut');
        const subject = `subject-${crypto.randomUUID()}`;
        const signInWithAccess = async () =>
            value(
                cookieOf(
                    await signIn(stub.idClaims({ sub: subject })),
                    sessionName(),
                ),
            );

        await signIn(
            stub.idClaims({ sub: subject }),
            await invite(clientId, actor.operatorId),
        );

        // Logout mengakhiri semua sesi identitas ini, termasuk yang dipegang perangkat lain.
        const first = await signInWithAccess();
        const second = await signInWithAccess();
        const logout = await call('/logout', {
            method: 'POST',
            cookie: first,
        });
        expect(logout.status).toBe(204);
        expect((await call('/api/v1/me', { cookie: second })).status).toBe(401);

        const third = await signInWithAccess();
        expect((await call('/api/v1/me', { cookie: third })).status).toBe(200);
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
        expect((await call('/api/v1/me', { cookie: third })).status).toBe(401);
        expect((await backchannel()).status).toBe(400);

        const fourth = await signInWithAccess();
        expect((await call('/api/v1/me', { cookie: fourth })).status).toBe(200);
        const [user] = await portalUsers(clientId);
        await revokePortalUser(db, actor, z.string().parse(user?.id));
        const revoked = await call('/api/v1/me', { cookie: fourth });
        expect(revoked.status).toBe(401);
        expect(
            revoked.headers
                .getSetCookie()
                .some((cookie) => cookie.startsWith(`${sessionName()}=;`)),
        ).toBe(true);
        expect(
            await target(await signIn(stub.idClaims({ sub: subject }))),
        ).toBe('/login?portal_error=not-linked');
    });
});
