import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';
import { createCustomer } from '../../../src/customers/customer/customer.service.ts';
import {
    inviteToPortal,
    type InvitationKind,
    revokePortalUser,
} from '../../../src/customers/portal-access/portal-access.service.ts';
import { addRuntimeHost } from '../../../src/environments/index.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { portalRouter } from '../../../src/portal.ts';
import { OidcStub } from '../../support/oidc-provider.ts';

const portalUrl = 'https://portal.example.test';
const appKey = 'base64:' + Buffer.alloc(32, 47).toString('base64');

// Cookie peramban untuk satu akun: sesi portal dan tenant aktifnya ikut setiap permintaan, dan diperbarui dari setiap
// jawaban.
class Jar {
    private readonly values = new Map<string, string>();
    take(response: Response): Response {
        for (const cookie of response.headers.getSetCookie()) {
            const [pair = '', ...attributes] = cookie.split(';');
            const position = pair.indexOf('=');
            const name = pair.slice(0, position);
            const value = pair.slice(position + 1);
            if (attributes.some((part) => part.trim() === 'Path=/sso'))
                continue;
            if (value === '') this.values.delete(name);
            else this.values.set(name, value);
        }
        return response;
    }
    get header(): string {
        return [...this.values]
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }
}

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('anggota dan tenant aktif portal', () => {
    if (!process.env.DB_HOST) return;
    let stub: OidcStub;
    let application: ReturnType<typeof createApplication>;
    let config: ReturnType<typeof loadConfig>;
    const pool = createPool(loadConfig({ ...process.env, APP_KEY: appKey }));
    const db = new Database(pool);

    beforeAll(async () => {
        stub = await OidcStub.start(`${portalUrl}/sso/callback`);
        config = loadConfig({
            ...process.env,
            APP_KEY: appKey,
            SESSION_SECURE_COOKIE: 'false',
            PORTAL_URL: portalUrl,
            PORTAL_SSO_ISSUER: stub.issuer,
            PORTAL_SSO_CLIENT_ID: stub.clientId,
            PORTAL_SSO_CLIENT_SECRET: stub.clientSecret,
            OPERATIONS_URL: 'https://operations.example.test',
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
        jar: Jar,
        path: string,
        init: { method?: string; body?: unknown; cookie?: string } = {},
    ) =>
        application
            .handle(
                new Request(`${portalUrl}${path}`, {
                    method: init.method ?? 'GET',
                    headers: {
                        'content-type': 'application/json',
                        cookie: init.cookie ?? jar.header,
                    },
                    body:
                        init.body === undefined
                            ? undefined
                            : JSON.stringify(init.body),
                }),
                '203.0.113.47',
            )
            .then((response) => jar.take(response));
    const json = async (response: Response) =>
        z.record(z.string(), z.unknown()).parse(await response.json());

    // Satu upacara SSO dengan tautan undangan, sampai sesi portal ada di jar.
    async function accept(jar: Jar, subject: string, acceptUrl: string) {
        const token = z
            .string()
            .parse(new URL(acceptUrl).searchParams.get('token'));
        const start = await application.handle(
            new Request(
                `${portalUrl}/sso/start?invitation=${encodeURIComponent(token)}`,
            ),
            '203.0.113.47',
        );
        expect(start.status).toBe(302);
        const ceremony = start.headers
            .getSetCookie()
            .find((cookie) => cookie.includes('_sso='))!
            .split(';')[0]!;
        const authorizeUrl = start.headers.get('location')!;
        const code = stub.grant(
            authorizeUrl,
            stub.idClaims({
                sub: subject,
                name: `Nama ${subject.slice(-6)}`,
                email: `${subject.slice(-6)}@sso.test`,
            }),
        );
        const state = new URL(authorizeUrl).searchParams.get('state');
        const callback = await call(
            jar,
            `/sso/callback?code=${code}&state=${state}`,
            { cookie: ceremony },
        );
        expect(await callback.text()).toContain('url=/"');
    }

    let operatorId: string | undefined;
    async function customer(legalName: string) {
        operatorId ??= (
            await createOperator(
                db,
                {
                    name: 'Operator Anggota',
                    email: `anggota-${crypto.randomUUID()}@example.com`,
                    password: 'correct horse battery staple',
                },
                { operatorId: null, ipAddress: null },
            )
        ).id;
        const host = await addRuntimeHost(db, {
            name: `host-anggota-${crypto.randomUUID()}`,
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
        const actor = { operatorId, ipAddress: null };
        const created = await createCustomer(db, actor, crypto.randomUUID(), {
            legal_name: legalName,
            slug: `anggota-${crypto.randomUUID().slice(-12)}`,
            admin: { name: 'Admin Pertama', email: 'admin@anggota.test' },
            environment: { kind: 'production', name: 'Produksi' },
        });
        const invite = (kind: InvitationKind, email: string) =>
            inviteToPortal(
                db,
                config,
                actor,
                {
                    clientId: created.client_id,
                    tenantId: created.tenant_id,
                    kind,
                },
                { recipient_email: email, recipient_name: null },
            );
        return { ...created, actor, invite };
    }

    const identities = async (tenantId: string) =>
        db.rows(
            z.object({
                issuer: z.string(),
                subject: z.string(),
                email: z.string().nullable(),
                name: z.string().nullable(),
                user_id: z.string().nullable(),
            }),
            `select issuer, subject, email, name, user_id from tenant_identities
             where tenant_id = $1 and deleted_at is null order by created_at, id`,
            [tenantId],
        );
    const portalUser = async (tenantId: string, subject: string) =>
        z.object({ id: z.string(), is_admin: z.boolean() }).parse(
            (
                await pool.unsafe(
                    `select id, is_admin from client_portal_users
                         where tenant_id = $1 and subject = $2 and deleted_at is null`,
                    [tenantId, subject],
                )
            )[0],
        );

    test('undangan admin menautkan ke admin pertama klinik, undangan member ke pengguna baru, dan hanya admin yang mengundang', async () => {
        const clinic = await customer('Klinik Anggota Sehat');
        const firstAdmin = z
            .object({ from_operation: z.string(), stored: z.string() })
            .parse(
                (
                    await pool.unsafe(
                        `select o.parameters -> 'admin' ->> 'id' as from_operation,
                            t.first_admin_user_id::text as stored
                         from environment_operations o, tenants t where o.id = $1 and t.id = $2`,
                        [clinic.operation_id, clinic.tenant_id],
                    )
                )[0],
            );
        expect(firstAdmin.stored).toBe(firstAdmin.from_operation);

        const admin = new Jar();
        const adminSubject = `admin-${crypto.randomUUID()}`;
        await accept(
            admin,
            adminSubject,
            (await clinic.invite('admin', 'kepala@anggota.test')).accept_url,
        );
        expect(await identities(clinic.tenant_id)).toEqual([
            {
                issuer: stub.issuer,
                subject: adminSubject,
                email: `${adminSubject.slice(-6)}@sso.test`,
                name: `Nama ${adminSubject.slice(-6)}`,
                user_id: firstAdmin.stored,
            },
        ]);
        const adminUser = await portalUser(clinic.tenant_id, adminSubject);
        expect(adminUser.is_admin).toBe(true);
        expect(await json(await call(admin, '/api/v1/me'))).toMatchObject({
            tenants: [{ id: clinic.tenant_id, is_admin: true }],
            active_tenant_id: clinic.tenant_id,
        });

        // Admin portal mengundang anggota; email dikirim dengan kredensial klien SSO portal.
        const invited = await call(admin, '/api/v1/members/invitations', {
            method: 'POST',
            body: {
                recipient_email: 'Perawat@Anggota.test',
                recipient_name: 'Perawat',
            },
        });
        expect(invited.status).toBe(201);
        const sent = z
            .object({ id: z.string(), accept_url: z.string() })
            .parse(await invited.json());
        const email = stub.invitations.at(-1)!;
        expect(email.headers.get('x-client-id')).toBe(stub.clientId);
        expect(email.body).toMatchObject({
            recipient_email: 'perawat@anggota.test',
            role_name: 'Anggota klinik',
            invited_by: `Nama ${adminSubject.slice(-6)}`,
            accept_url: sent.accept_url,
        });
        const [audit] = await pool.unsafe(
            `select operator_id, detail from operator_audit_events
             where action = 'customer.portal_invited' and detail ->> 'invitation_id' = $1`,
            [sent.id],
        );
        expect({ ...audit }).toEqual({
            operator_id: null,
            detail: expect.objectContaining({
                tenant_id: clinic.tenant_id,
                kind: 'member',
                portal_user_id: adminUser.id,
            }),
        });

        const member = new Jar();
        const memberSubject = `member-${crypto.randomUUID()}`;
        await accept(member, memberSubject, sent.accept_url);
        expect(await identities(clinic.tenant_id)).toEqual([
            expect.objectContaining({
                subject: adminSubject,
                user_id: firstAdmin.stored,
            }),
            expect.objectContaining({ subject: memberSubject, user_id: null }),
        ]);
        expect(
            (await portalUser(clinic.tenant_id, memberSubject)).is_admin,
        ).toBe(false);

        // Anggota bukan admin: melihat daftar, tetapi tidak mengundang, mengirim ulang, atau membatalkan.
        const listed = await json(await call(member, '/api/v1/members'));
        expect(listed.can_invite).toBe(false);
        const pending = await clinic.invite('member', 'lain@anggota.test');
        expect(
            (
                await call(member, '/api/v1/members/invitations', {
                    method: 'POST',
                    body: {
                        recipient_email: 'x@anggota.test',
                        recipient_name: null,
                    },
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await call(
                    member,
                    `/api/v1/members/invitations/${pending.id}/resend`,
                    { method: 'POST', body: {} },
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await call(
                    member,
                    `/api/v1/members/invitations/${pending.id}`,
                    { method: 'DELETE', body: {} },
                )
            ).status,
        ).toBe(403);

        // Admin mengirim ulang dan membatalkan undangan tenantnya.
        expect(
            (
                await call(
                    admin,
                    `/api/v1/members/invitations/${pending.id}/resend`,
                    { method: 'POST', body: {} },
                )
            ).status,
        ).toBe(200);
        expect(
            (
                await call(admin, `/api/v1/members/invitations/${pending.id}`, {
                    method: 'DELETE',
                    body: {},
                })
            ).status,
        ).toBe(204);
        const members = z
            .object({
                can_invite: z.boolean(),
                members: z.array(
                    z.object({ kind: z.string(), admin: z.boolean() }),
                ),
            })
            .parse(await json(await call(admin, '/api/v1/members')));
        expect(members.can_invite).toBe(true);
        expect(members.members).toEqual([
            expect.objectContaining({ kind: 'user', admin: true }),
            expect.objectContaining({ kind: 'user', admin: false }),
        ]);

        // Mencabut akses portal tidak mencabut tautan ke pengguna klinik.
        await revokePortalUser(
            db,
            clinic.actor,
            (await portalUser(clinic.tenant_id, memberSubject)).id,
        );
        expect(await identities(clinic.tenant_id)).toHaveLength(2);
    });

    test('undangan dan tenant aktif tidak menjangkau tenant lain', async () => {
        const own = await customer('Klinik Sendiri');
        const other = await customer('Klinik Tetangga');
        const jar = new Jar();
        const subject = `lintas-${crypto.randomUUID()}`;
        await accept(
            jar,
            subject,
            (await own.invite('admin', 'kepala@sendiri.test')).accept_url,
        );
        const foreign = await other.invite('member', 'staf@tetangga.test');

        expect(
            (
                await call(
                    jar,
                    `/api/v1/members/invitations/${foreign.id}/resend`,
                    { method: 'POST', body: {} },
                )
            ).status,
        ).toBe(404);
        expect(
            (
                await call(jar, `/api/v1/members/invitations/${foreign.id}`, {
                    method: 'DELETE',
                    body: {},
                })
            ).status,
        ).toBe(404);
        expect(
            JSON.stringify(await json(await call(jar, '/api/v1/members'))),
        ).not.toContain(foreign.id);

        // Tenant yang tidak bisa dibuka identitas ini ditolak, sama dengan tenant yang tidak ada.
        for (const tenantId of [other.tenant_id, crypto.randomUUID()])
            expect(
                (
                    await call(jar, '/api/v1/active-tenant', {
                        method: 'PUT',
                        body: { tenant_id: tenantId },
                    })
                ).status,
            ).toBe(404);
        expect(await json(await call(jar, '/api/v1/me'))).toMatchObject({
            active_tenant_id: own.tenant_id,
        });
        // Cookie tenant yang dipalsukan diganti tenant pertama yang bisa dibuka.
        const forged = await call(jar, '/api/v1/environments', {
            cookie: jar.header.replace(
                /(_portal_tenant=)[^;]+/,
                `$1${other.tenant_id}`,
            ),
        });
        expect(
            z
                .object({ tenant: z.object({ id: z.string() }) })
                .parse(await forged.json()).tenant.id,
        ).toBe(own.tenant_id);

        // Akses member ke tenant kedua: kini bisa dipilih, dan data portal mengikuti pilihan itu.
        await accept(
            jar,
            subject,
            (await other.invite('member', 'kepala@tetangga.test')).accept_url,
        );
        expect(
            (
                await call(jar, '/api/v1/active-tenant', {
                    method: 'PUT',
                    body: { tenant_id: other.tenant_id },
                })
            ).status,
        ).toBe(204);
        expect(await json(await call(jar, '/api/v1/me'))).toMatchObject({
            tenants: [
                { id: own.tenant_id, is_admin: true },
                { id: other.tenant_id, is_admin: false },
            ],
            active_tenant_id: other.tenant_id,
        });
        const environments = z
            .object({
                tenant: z.object({
                    id: z.string(),
                    environments: z.array(
                        z.object({ address: z.string().nullable() }),
                    ),
                }),
            })
            .parse(await json(await call(jar, '/api/v1/environments')));
        expect(environments.tenant.id).toBe(other.tenant_id);
        expect(environments.tenant.environments[0]?.address).toStartWith(
            'https://anggota-',
        );
        expect(
            (await json(await call(jar, '/api/v1/members'))).can_invite,
        ).toBe(false);

        // Akses yang dicabut tidak lagi dipakai sebagai tenant aktif.
        await revokePortalUser(
            db,
            other.actor,
            (await portalUser(other.tenant_id, subject)).id,
        );
        expect(await json(await call(jar, '/api/v1/me'))).toMatchObject({
            active_tenant_id: own.tenant_id,
        });
    });
});
