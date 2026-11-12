import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    createPool,
    Database,
} from '../../../../src/platform/database/index.ts';
import { hashInvitationToken } from '../../../../src/platform/oidc/index.ts';
import { createOperator } from '../../../../src/platform/operator-identity/index.ts';
import { consoleTestApp } from '../../../support/console-app.ts';
import { OidcStub } from '../../../support/oidc-provider.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('undangan operator', () => {
    if (!process.env.DB_HOST) return;
    let stub: OidcStub;
    let app: ReturnType<typeof consoleTestApp>;
    let db: Database;
    const password = 'correct horse battery staple';
    let inviter: { email: string; session: string };

    beforeAll(async () => {
        stub = await OidcStub.start(
            'https://console.example.test/sso/callback',
        );
        app = consoleTestApp(41, {
            CONSOLE_SSO_ISSUER: stub.issuer,
            CONSOLE_SSO_CLIENT_ID: stub.clientId,
            CONSOLE_SSO_CLIENT_SECRET: stub.clientSecret,
            CONSOLE_SSO_REDIRECT_URI: stub.redirectUri,
        });
        db = new Database(app.pool);
        const email = `inviter-${crypto.randomUUID()}@example.com`;
        await createOperator(
            db,
            { name: 'Operator Pengundang', email, password },
            { operatorId: null, ipAddress: null },
        );
        const login = await app.call('/login', {
            method: 'POST',
            body: { email, password },
        });
        inviter = { email, session: app.sessionOf(login) };
    });
    afterAll(async () => {
        stub.stop();
        await db.release();
        await app.close();
    });

    const target = async (response: Response) =>
        /url=([^"]+)"/
            .exec(await response.text())?.[1]
            ?.replaceAll('&amp;', '&');
    const tokenOf = (acceptUrl: string) =>
        z.string().parse(new URL(acceptUrl).searchParams.get('token'));
    const sentSchema = z.object({
        id: z.string(),
        accept_url: z.string(),
        email_failure: z.string().nullable(),
    });
    const stored = async (id: string) =>
        z
            .object({
                token_hash: z.string(),
                notified: z.boolean(),
                accepted_at: z.string().nullable(),
                accepted_operator_id: z.string().nullable(),
            })
            .parse(
                (
                    await app.pool.unsafe(
                        `select token_hash, notified_at is not null as notified, accepted_at::text,
                            accepted_operator_id::text
                         from operator_invitations where id = $1`,
                        [id],
                    )
                )[0],
            );

    async function invite(email: string, name: string | null = null) {
        const response = await app.call('/api/v1/operator-invitations', {
            method: 'POST',
            body: { recipient_email: email, recipient_name: name },
            cookie: inviter.session,
        });
        expect(response.status).toBe(201);
        return sentSchema.parse(await response.json());
    }

    // Membuka tautan undangan lalu kembali dari penyedia SSO dengan klaim ini.
    async function accept(token: string, claims: Record<string, unknown>) {
        const start = await app.call(
            `/sso/start?invitation=${encodeURIComponent(token)}`,
        );
        expect(start.status).toBe(302);
        const authorizeUrl = start.headers.get('location')!;
        const ceremony = app.cookieOf(
            start,
            `${app.config.SESSION_COOKIE}_sso`,
        )!;
        const state = new URL(authorizeUrl).searchParams.get('state');
        const code = stub.grant(authorizeUrl, claims);
        return app.call(`/sso/callback?code=${code}&state=${state}`, {
            cookie: ceremony,
        });
    }

    test('undangan dikirim dengan klien SSO konsol, hanya hash token yang disimpan, kirim ulang mengganti tautan, dan batal menutupnya', async () => {
        const email = `baru-${crypto.randomUUID()}@example.com`;
        stub.invitationReply = { status: 200, body: { message: 'ok' } };
        const sent = await invite(email.toUpperCase(), 'Operator Baru');
        expect(sent.email_failure).toBeNull();
        expect(sent.accept_url).toStartWith(
            'https://console.example.test/invitation?token=',
        );
        const request = stub.invitations.at(-1)!;
        expect(request.headers.get('x-client-id')).toBe(stub.clientId);
        expect(request.headers.get('x-client-secret')).toBe(stub.clientSecret);
        expect(request.body).toMatchObject({
            recipient_email: email,
            recipient_name: 'Operator Baru',
            accept_url: sent.accept_url,
            invited_by: 'Operator Pengundang',
            expires_in_days: 7,
        });
        const first = await stored(sent.id);
        expect(first.token_hash).toBe(
            hashInvitationToken(tokenOf(sent.accept_url)),
        );
        expect(first.notified).toBe(true);

        // Email yang sudah punya undangan, atau sudah dipakai operator, tidak diundang lagi.
        for (const taken of [email, inviter.email]) {
            const again = await app.call('/api/v1/operator-invitations', {
                method: 'POST',
                body: { recipient_email: taken, recipient_name: null },
                cookie: inviter.session,
            });
            expect(again.status).toBe(422);
        }

        stub.invitationReply = {
            status: 422,
            body: { message: 'Domain pada accept_url tidak sesuai.' },
        };
        const resend = await app.call(
            `/api/v1/operator-invitations/${sent.id}/resend`,
            { method: 'POST', cookie: inviter.session },
        );
        expect(resend.status).toBe(200);
        const resent = sentSchema.parse(await resend.json());
        expect(resent.email_failure).toBe(
            'Domain pada accept_url tidak sesuai.',
        );
        const second = await stored(sent.id);
        expect(second.token_hash).toBe(
            hashInvitationToken(tokenOf(resent.accept_url)),
        );
        expect(second.token_hash).not.toBe(first.token_hash);
        expect(second.notified).toBe(false);
        expect(
            (
                await app.call(
                    `/api/v1/invitation?token=${tokenOf(sent.accept_url)}`,
                )
            ).status,
        ).toBe(404);

        const list = await app.call('/api/v1/operators', {
            cookie: inviter.session,
        });
        const listed = z
            .object({
                sso_configured: z.boolean(),
                rows: z.array(z.looseObject({ id: z.string() })),
            })
            .parse(await list.json());
        expect(listed.sso_configured).toBe(true);
        expect(listed.rows.find((row) => row.id === sent.id)).toMatchObject({
            kind: 'invitation',
            email,
            notified: false,
            expired: false,
        });

        const cancel = await app.call(
            `/api/v1/operator-invitations/${sent.id}`,
            { method: 'DELETE', cookie: inviter.session },
        );
        expect(cancel.status).toBe(204);
        expect(
            await target(
                await app.call(
                    `/sso/start?invitation=${tokenOf(resent.accept_url)}`,
                ),
            ),
        ).toBe('/login?sso_error=invitation-invalid');

        const [audit] = await app.pool.unsafe(
            `select array_agg(action order by action) as actions from operator_audit_events
             where subject_id = $1`,
            [sent.id],
        );
        expect(audit?.actions).toEqual([
            'operator.invitation_cancelled',
            'operator.invitation_resent',
            'operator.invited',
        ]);
    });

    test('menerima undangan melahirkan operator tanpa password yang tertaut ke SSO dan langsung login', async () => {
        const email = `terima-${crypto.randomUUID()}@example.com`;
        const subject = `subject-${crypto.randomUUID()}`;
        stub.invitationReply = { status: 200, body: { message: 'ok' } };
        const sent = await invite(email);
        const token = tokenOf(sent.accept_url);

        const shown = await app.call(`/api/v1/invitation?token=${token}`);
        expect(await shown.json()).toEqual({
            invited_by: 'Operator Pengundang',
            usable: true,
        });

        const accepted = await accept(
            token,
            stub.idClaims({ sub: subject, email, name: 'Dari SSO' }),
        );
        expect(await target(accepted)).toBe('/');
        const session = app.sessionOf(accepted);
        const me = await app.call('/api/v1/me', { cookie: session });
        expect(me.status).toBe(200);
        const body = z
            .object({
                operator: z.object({ id: z.string(), name: z.string() }),
                sso: z.object({
                    linked: z.boolean(),
                    has_password: z.boolean(),
                }),
            })
            .parse(await me.json());
        expect(body.operator.name).toBe('Dari SSO');
        expect(body.sso).toEqual({ linked: true, has_password: false });

        const [operator] = await app.pool.unsafe(
            'select password from operators where id = $1',
            [body.operator.id],
        );
        expect(operator?.password).toBeNull();
        const row = await stored(sent.id);
        expect(row.accepted_at).not.toBeNull();
        expect(row.accepted_operator_id).toBe(body.operator.id);

        // Tautan yang sudah dipakai tidak bisa dipakai lagi.
        expect(
            await target(await app.call(`/sso/start?invitation=${token}`)),
        ).toBe('/login?sso_error=invitation-invalid');

        // Tidak ada password yang cocok, dan jawabannya sama dengan password salah.
        for (const attempt of ['', 'anything', password]) {
            const login = await app.call('/login', {
                method: 'POST',
                body: { email, password: attempt },
            });
            expect(login.status).toBe(422);
            expect(await login.json()).toMatchObject({
                message: 'Email atau password tidak cocok.',
            });
        }
        // Tautan SSO adalah satu-satunya jalan masuknya, jadi tidak bisa dilepas.
        expect(
            (
                await app.call('/api/v1/sso/link', {
                    method: 'DELETE',
                    cookie: session,
                })
            ).status,
        ).toBe(409);

        // Login SSO berikutnya masuk sebagai operator yang sama.
        const start = await app.call('/sso/start');
        const authorizeUrl = start.headers.get('location')!;
        const code = stub.grant(authorizeUrl, stub.idClaims({ sub: subject }));
        const again = await app.call(
            `/sso/callback?code=${code}&state=${new URL(authorizeUrl).searchParams.get('state')}`,
            {
                cookie: app.cookieOf(
                    start,
                    `${app.config.SESSION_COOKIE}_sso`,
                )!,
            },
        );
        expect(await target(again)).toBe('/');
    });

    test('undangan yang kedaluwarsa ditolak, juga bila lewat masanya selama login SSO berjalan', async () => {
        const sent = await invite(`lewat-${crypto.randomUUID()}@example.com`);
        const token = tokenOf(sent.accept_url);
        const start = await app.call(`/sso/start?invitation=${token}`);
        expect(start.status).toBe(302);
        await db.execute(
            "update operator_invitations set expires_at = now() at time zone 'utc' - interval '1 minute' where id = $1",
            [sent.id],
        );
        expect(
            await target(await app.call(`/sso/start?invitation=${token}`)),
        ).toBe('/login?sso_error=invitation-invalid');
        expect(
            await (await app.call(`/api/v1/invitation?token=${token}`)).json(),
        ).toMatchObject({ usable: false });

        const authorizeUrl = start.headers.get('location')!;
        const code = stub.grant(
            authorizeUrl,
            stub.idClaims({ sub: `subject-${crypto.randomUUID()}` }),
        );
        const callback = await app.call(
            `/sso/callback?code=${code}&state=${new URL(authorizeUrl).searchParams.get('state')}`,
            {
                cookie: app.cookieOf(
                    start,
                    `${app.config.SESSION_COOKIE}_sso`,
                )!,
            },
        );
        expect(await target(callback)).toBe(
            '/login?sso_error=invitation-invalid',
        );
        expect(app.sessionOf(callback)).toBe('');
        expect((await stored(sent.id)).accepted_at).toBeNull();
    });

    test('akun SSO yang sudah tertaut tidak melahirkan operator kedua', async () => {
        const subject = `subject-${crypto.randomUUID()}`;
        const first = await invite(
            `pertama-${crypto.randomUUID()}@example.com`,
        );
        const created = await accept(
            tokenOf(first.accept_url),
            stub.idClaims({ sub: subject, email: undefined }),
        );
        expect(await target(created)).toBe('/');
        const operatorId = (await stored(first.id)).accepted_operator_id;

        const secondEmail = `kedua-${crypto.randomUUID()}@example.com`;
        const second = await invite(secondEmail);
        const reused = await accept(
            tokenOf(second.accept_url),
            stub.idClaims({ sub: subject, email: secondEmail }),
        );
        expect(await target(reused)).toBe('/');
        const me = await app.call('/api/v1/me', {
            cookie: app.sessionOf(reused),
        });
        expect(await me.json()).toMatchObject({ operator: { id: operatorId } });
        expect((await stored(second.id)).accepted_operator_id).toBe(operatorId);
        const [count] = await app.pool.unsafe(
            'select count(*)::int as count from operators where lower(email) = $1',
            [secondEmail],
        );
        expect(count?.count).toBe(0);
    });
});
