import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';
import { createCustomer } from '../../../src/customers/customer/customer.service.ts';
import {
    cancelPortalInvitation,
    inviteToPortal,
    listPortalAccess,
    resendPortalInvitation,
    revokePortalUser,
} from '../../../src/customers/portal-access/portal-access.service.ts';
import { addRuntimeHost } from '../../../src/environments/index.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { hashInvitationToken } from '../../../src/platform/oidc/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';

// Penyedia SSO tiruan yang benar-benar menerima HTTP, supaya bentuk permintaan undangan ikut diperiksa.
function notificationStub() {
    const requests: { headers: Headers; body: Record<string, unknown> }[] = [];
    let reply: { status: number; body: unknown } = {
        status: 200,
        body: { message: 'ok' },
    };
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            if (
                new URL(request.url).pathname !==
                '/api/v1/notifications/send-invitation'
            )
                return new Response('not found', { status: 404 });
            requests.push({
                headers: request.headers,
                body: z
                    .record(z.string(), z.unknown())
                    .parse(await request.json()),
            });
            return Response.json(reply.body, { status: reply.status });
        },
    });
    return {
        issuer: `http://127.0.0.1:${String(server.port)}`,
        requests,
        answer: (status: number, body: unknown) => {
            reply = { status, body };
        },
        stop: () => server.stop(true),
    };
}

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('akses portal klien', () => {
    if (!process.env.DB_HOST) return;
    const stub = notificationStub();
    const config = loadConfig({
        ...process.env,
        APP_KEY: 'base64:' + Buffer.alloc(32, 31).toString('base64'),
        PORTAL_URL: 'https://portal.example.test/',
        PORTAL_SSO_ISSUER: stub.issuer,
        PORTAL_SSO_CLIENT_ID: 'portal-client',
        PORTAL_SSO_CLIENT_SECRET: 'portal-secret',
    });
    const pool = createPool(config);
    const db = new Database(pool);
    afterAll(async () => {
        stub.stop();
        await db.release();
        await pool.end();
    });

    async function setup() {
        const operator = await createOperator(
            db,
            {
                name: 'Operator Portal',
                email: `portal-${crypto.randomUUID()}@example.com`,
                password: 'correct horse battery staple',
            },
            { operatorId: null, ipAddress: null },
        );
        const host = await addRuntimeHost(db, {
            name: `host-portal-${crypto.randomUUID()}`,
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
        const created = await createCustomer(db, actor, crypto.randomUUID(), {
            legal_name: 'PT Klinik Portal',
            slug: `portal-${crypto.randomUUID().slice(-12)}`,
            admin: { name: 'Admin', email: 'admin@portal.test' },
            environment: { kind: 'production', name: 'Produksi' },
        });
        return { actor, clientId: created.client_id };
    }
    const stored = async (id: string) =>
        z
            .object({ token_hash: z.string(), notified: z.boolean() })
            .parse(
                (
                    await pool.unsafe(
                        'select token_hash, notified_at is not null as notified from client_portal_invitations where id = $1',
                        [id],
                    )
                )[0],
            );
    const tokenOf = (acceptUrl: string) =>
        z.string().parse(new URL(acceptUrl).searchParams.get('token'));

    test('undangan dikirim lewat penyedia SSO, hanya hash token yang disimpan, dan kirim ulang mengganti tautannya', async () => {
        const { actor, clientId } = await setup();
        stub.answer(200, { message: 'ok' });
        const sent = await inviteToPortal(db, config, actor, clientId, {
            recipient_email: 'kepala@klinik.test',
            recipient_name: 'Kepala Klinik',
        });
        expect(sent.email_failure).toBeNull();
        expect(sent.accept_url).toStartWith(
            'https://portal.example.test/invitation?token=',
        );
        const request = stub.requests.at(-1)!;
        expect(request.headers.get('x-client-id')).toBe('portal-client');
        expect(request.headers.get('x-client-secret')).toBe('portal-secret');
        expect(request.body).toMatchObject({
            recipient_email: 'kepala@klinik.test',
            recipient_name: 'Kepala Klinik',
            accept_url: sent.accept_url,
            invited_by: 'Operator Portal',
            expires_in_days: 7,
        });
        const first = await stored(sent.id);
        expect(first).toEqual({
            token_hash: hashInvitationToken(tokenOf(sent.accept_url)),
            notified: true,
        });

        stub.answer(422, {
            error: 'invalid_accept_url',
            message: 'Domain pada accept_url tidak sesuai.',
        });
        const resent = await resendPortalInvitation(db, config, actor, sent.id);
        expect(resent.email_failure).toBe(
            'Domain pada accept_url tidak sesuai.',
        );
        const second = await stored(sent.id);
        expect(second.token_hash).toBe(
            hashInvitationToken(tokenOf(resent.accept_url)),
        );
        expect(second.token_hash).not.toBe(first.token_hash);
        expect(second.notified).toBe(false);

        const listed = await listPortalAccess(db, clientId);
        expect(listed).toEqual([
            expect.objectContaining({
                kind: 'invitation',
                id: sent.id,
                email: 'kepala@klinik.test',
                notified: false,
                expired: false,
            }),
        ]);
        await cancelPortalInvitation(db, actor, sent.id);
        expect(await listPortalAccess(db, clientId)).toEqual([]);
        await expect(
            resendPortalInvitation(db, config, actor, sent.id),
        ).rejects.toMatchObject({ status: 404 });
    });

    test('akses yang sudah tertaut bisa dicabut, dan undangan ditolak bila portal tidak disetel', async () => {
        const { actor, clientId } = await setup();
        stub.answer(200, { message: 'ok' });
        const sent = await inviteToPortal(db, config, actor, clientId, {
            recipient_email: 'staf@klinik.test',
            recipient_name: null,
        });
        const userId = Bun.randomUUIDv7();
        await db.execute(
            `update client_portal_invitations set accepted_at = now() at time zone 'utc' where id = $1`,
            [sent.id],
        );
        await db.execute(
            `insert into client_portal_users (id, client_id, issuer, subject, email_at_link, invitation_id, created_at, updated_at)
             values ($1, $2, 'https://sso.example.test', $3, 'staf@klinik.test', $4, now(), now())`,
            [userId, clientId, crypto.randomUUID(), sent.id],
        );
        expect(await listPortalAccess(db, clientId)).toEqual([
            expect.objectContaining({ kind: 'user', id: userId }),
        ]);
        await revokePortalUser(db, actor, userId);
        expect(await listPortalAccess(db, clientId)).toEqual([]);

        const [audit] = await pool.unsafe(
            `select array_agg(action order by action) as actions from operator_audit_events
             where subject_id = $1 and action like 'customer.portal_%'`,
            [clientId],
        );
        expect(audit?.actions).toEqual([
            'customer.portal_access_revoked',
            'customer.portal_invited',
        ]);

        const withoutPortal = loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 31).toString('base64'),
        });
        await expect(
            inviteToPortal(db, withoutPortal, actor, clientId, {
                recipient_email: 'lain@klinik.test',
                recipient_name: null,
            }),
        ).rejects.toMatchObject({ status: 409 });
    });
});
