import { afterAll, describe, expect, test } from 'bun:test';
import { agentRouter } from '../../../src/agent.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import {
    fromAgentId,
    issueEnrollmentToken,
    toAgentId,
} from '../../../src/sites/index.ts';
import { signedRequest, siteKeyPair } from '../../support/agent-client.ts';
import { createSite } from '../../support/sites.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)(
    'site enrollment and key rotation',
    () => {
        if (!process.env.DB_HOST) return;
        const config = loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 8).toString('base64'),
        });
        const application = createApplication(config, agentRouter);
        const pool = createPool(config);
        const db = new Database(pool);
        const address = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
        afterAll(async () => {
            await db.release();
            await application.close();
            await pool.end();
        });

        const call = (request: Request) => application.handle(request, address);
        const enroll = (body: unknown) =>
            call(
                new Request('http://localhost/api/agent/v1/enroll', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                }),
            );
        const report = (siteId: string, privateKey: string) =>
            call(
                signedRequest({
                    method: 'POST',
                    path: '/api/agent/v1/report',
                    keyId: siteId,
                    privateKey,
                    body: {
                        site_id: siteId,
                        agent_version: '0.1.0',
                        created_at: new Date().toISOString(),
                        server_time: new Date().toISOString(),
                    },
                }),
            );

        test('enrolls once with a token and answers ids as ULID', async () => {
            const { siteId, tenantId } = await createSite(db, {
                tenantName: 'Klinik Sehat',
                window: ['01:00', '04:30'],
            });
            const keys = siteKeyPair();
            const { token } = await issueEnrollmentToken(db, siteId, null);

            // Kunci yang tidak sah tidak menghabiskan token.
            const badKey = await enroll({
                token,
                public_key: 'not a key',
                agent_version: '0.1.0',
            });
            expect(badKey.status).toBe(422);
            expect(await badKey.json()).toEqual({
                error: 'public_key_invalid',
            });
            expect(
                (
                    await enroll({
                        token,
                        public_key: keys.publicKey,
                        agent_version: '0.1.0',
                        extra: true,
                    })
                ).status,
            ).toBe(422);

            const enrolled = await enroll({
                token,
                public_key: keys.publicKey,
                agent_version: '0.1.0',
            });
            expect(enrolled.status).toBe(201);
            expect(await enrolled.json()).toEqual({
                site_id: toAgentId(siteId),
                tenant_id: toAgentId(tenantId),
                tenant_name: 'Klinik Sehat',
                interval_seconds: 60,
                update_window: {
                    start: '01:00',
                    end: '04:30',
                    timezone: 'Asia/Jakarta',
                },
                license_public_key: null,
            });

            const again = await enroll({
                token,
                public_key: keys.publicKey,
                agent_version: '0.1.0',
            });
            expect(again.status).toBe(401);
            expect(await again.json()).toEqual({
                error: 'enrollment_rejected',
            });
            expect(
                (await report(toAgentId(siteId), keys.privateKey)).status,
            ).toBe(200);
        });

        test('rejects expired tokens and tokens of revoked sites the same way', async () => {
            const keys = siteKeyPair();
            const expired = await createSite(db);
            const { token: old } = await issueEnrollmentToken(
                db,
                expired.siteId,
                null,
            );
            await db.execute(
                "update site_enrollment_tokens set expires_at = now() - interval '1 minute' where site_id = $1",
                [expired.siteId],
            );
            const revoked = await createSite(db);
            const { token: revokedToken } = await issueEnrollmentToken(
                db,
                revoked.siteId,
                null,
            );
            await db.execute(
                'update sites set revoked_at = now() where id = $1',
                [revoked.siteId],
            );
            for (const token of [old, revokedToken, 'x'.repeat(48)]) {
                const response = await enroll({
                    token,
                    public_key: keys.publicKey,
                    agent_version: '0.1.0',
                });
                expect(response.status).toBe(401);
                expect(await response.json()).toEqual({
                    error: 'enrollment_rejected',
                });
            }
        });

        test('a new token voids the unused one', async () => {
            const keys = siteKeyPair();
            const { siteId } = await createSite(db);
            const { token: first } = await issueEnrollmentToken(
                db,
                siteId,
                null,
            );
            const { token: second } = await issueEnrollmentToken(
                db,
                siteId,
                null,
            );
            const enroll2 = (token: string) =>
                enroll({
                    token,
                    public_key: keys.publicKey,
                    agent_version: '0.1.0',
                });
            expect((await enroll2(first)).status).toBe(401);
            expect((await enroll2(second)).status).toBe(201);
        });

        test('after a key rotation only the new key signs', async () => {
            const oldKeys = siteKeyPair();
            const newKeys = siteKeyPair();
            const { siteId } = await createSite(db);
            const { token } = await issueEnrollmentToken(db, siteId, null);
            await enroll({
                token,
                public_key: oldKeys.publicKey,
                agent_version: '0.1.0',
            });
            const agentId = toAgentId(siteId);

            const invalid = await call(
                signedRequest({
                    method: 'POST',
                    path: '/api/agent/v1/key',
                    keyId: agentId,
                    privateKey: oldKeys.privateKey,
                    body: { public_key: 'not a key' },
                }),
            );
            expect(invalid.status).toBe(422);
            const rotated = await call(
                signedRequest({
                    method: 'POST',
                    path: '/api/agent/v1/key',
                    keyId: agentId,
                    privateKey: oldKeys.privateKey,
                    body: { public_key: newKeys.publicKey },
                }),
            );
            expect(rotated.status).toBe(200);
            expect(await rotated.text()).toBe('');

            const withOld = await report(agentId, oldKeys.privateKey);
            expect(withOld.status).toBe(401);
            expect(await withOld.json()).toEqual({
                error: 'signature_invalid',
            });
            expect((await report(agentId, newKeys.privateKey)).status).toBe(
                200,
            );
            // Agen yang mendaftar di CoreERP menandatangani dengan id situs ULID; uuid juga diterima.
            expect(fromAgentId(agentId)).toBe(siteId);
            expect((await report(siteId, newKeys.privateKey)).status).toBe(200);
        });
    },
);
