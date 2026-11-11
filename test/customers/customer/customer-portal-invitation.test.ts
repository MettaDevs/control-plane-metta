import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';
import { addRuntimeHost } from '../../../src/environments/index.ts';
import { Database } from '../../../src/platform/database/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { consoleTestApp } from '../../support/console-app.ts';

// Penyedia SSO tiruan yang benar-benar menerima HTTP untuk permintaan mengirim undangan.
const requests: Record<string, unknown>[] = [];
const provider = Bun.serve({
    port: 0,
    async fetch(request) {
        requests.push(
            z.record(z.string(), z.unknown()).parse(await request.json()),
        );
        return Response.json({ message: 'ok' });
    },
});

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)(
    'customer baru mengundang admin ke portal',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, call, sessionOf, close } = consoleTestApp(43, {
            PORTAL_URL: 'https://portal.example.test',
            PORTAL_SSO_ISSUER: `http://127.0.0.1:${String(provider.port)}`,
            PORTAL_SSO_CLIENT_ID: 'portal-client',
            PORTAL_SSO_CLIENT_SECRET: 'portal-secret',
        });
        const db = new Database(pool);
        afterAll(async () => {
            await provider.stop(true);
            await db.release();
            await close();
        });

        test('admin pertama diundang sekali, dan permintaan ulang dengan kunci yang sama tidak mengirim email lagi', async () => {
            const email = `invite-${crypto.randomUUID()}@example.com`;
            const password = 'correct horse battery staple';
            await createOperator(
                db,
                { name: 'Operator Undang', email, password },
                { operatorId: null, ipAddress: null },
            );
            const host = await addRuntimeHost(db, {
                name: `host-undang-${crypto.randomUUID()}`,
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
            const cookie = sessionOf(
                await call('/login', {
                    method: 'POST',
                    body: { email, password },
                }),
            );
            const key = crypto.randomUUID();
            const create = () =>
                call('/api/v1/customers', {
                    method: 'POST',
                    cookie,
                    headers: { 'idempotency-key': key },
                    body: {
                        legal_name: 'PT Klinik Undang',
                        slug: `undang-${crypto.randomUUID().slice(-12)}`,
                        admin: {
                            name: 'Kepala Klinik',
                            email: 'Kepala@Klinik.test',
                        },
                        environment: { kind: 'production' },
                    },
                });
            const response = await create();
            expect(response.status).toBe(201);
            const created = z
                .object({
                    client_id: z.string(),
                    portal_invitation: z.object({
                        id: z.string(),
                        accept_url: z.string(),
                        email_failure: z.null(),
                    }),
                })
                .parse(await response.json());
            expect(requests).toHaveLength(1);
            expect(requests[0]).toMatchObject({
                recipient_email: 'kepala@klinik.test',
                recipient_name: 'Kepala Klinik',
                accept_url: created.portal_invitation.accept_url,
            });
            const [invitation] = await pool.unsafe(
                'select client_id, notified_at is not null as notified from client_portal_invitations where id = $1',
                [created.portal_invitation.id],
            );
            expect({ ...invitation }).toEqual({
                client_id: created.client_id,
                notified: true,
            });

            const replay = await create();
            expect(
                z
                    .object({ portal_invitation: z.null() })
                    .parse(await replay.json()).portal_invitation,
            ).toBeNull();
            expect(requests).toHaveLength(1);
        });
    },
);
