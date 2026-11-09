import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { agentRouter } from '../../../src/agent.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { issueEnrollmentToken, toAgentId } from '../../../src/sites/index.ts';
import { signedRequest, siteKeyPair } from '../../support/agent-client.ts';
import { createSite } from '../../support/sites.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('site report', () => {
    if (!process.env.DB_HOST) return;
    const config = loadConfig({
        ...process.env,
        APP_KEY: 'base64:' + Buffer.alloc(32, 9).toString('base64'),
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

    async function enrolledSite() {
        const keys = siteKeyPair();
        const { siteId } = await createSite(db);
        const { token } = await issueEnrollmentToken(db, siteId, null);
        const enrolled = await application.handle(
            new Request('http://localhost/api/agent/v1/enroll', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    token,
                    public_key: keys.publicKey,
                    agent_version: '0.1.0',
                }),
            }),
            address,
        );
        expect(enrolled.status).toBe(201);
        return { siteId, agentId: toAgentId(siteId), keys };
    }

    const sample = (
        agentId: string,
        overrides: Record<string, unknown> = {},
    ) => ({
        site_id: agentId,
        agent_version: '0.1.0',
        created_at: new Date().toISOString(),
        server_time: new Date().toISOString(),
        edition: 'coreerp',
        release: '0.9.1',
        image: 'registry.example.com/coreerp/core:0.9.1',
        digest: 'sha256:' + 'a'.repeat(64),
        containers: [
            { service: 'core-app', state: 'running', health: 'healthy' },
        ],
        disk: { data_free_bytes: 1000, backup_free_bytes: 2000 },
        last_backup: null,
        last_operation: null,
        certificate_expires_at: null,
        license_expires_at: '2026-12-31',
        license_perpetual: false,
        license_required: true,
        finance_feed: {
            counts: { held: 0, pending: 1, posted: 2, rejected: 0, manual: 0 },
            oldest_pending_at: '2026-11-09T05:00:00Z',
            last_pulled_at: null,
        },
        ...overrides,
    });

    const send = (
        site: Awaited<ReturnType<typeof enrolledSite>>,
        body: unknown,
        keyId = site.agentId,
    ) =>
        application.handle(
            signedRequest({
                method: 'POST',
                path: '/api/agent/v1/report',
                keyId,
                privateKey: site.keys.privateKey,
                body,
            }),
            address,
        );

    const history = (siteId: string) =>
        db.rows(
            z.object({ release: z.string().nullable() }),
            `select payload->>'release' as release from site_reports where site_id = $1 order by received_at, id`,
            [siteId],
        );

    test('stores the latest state and keeps history only when the server changed', async () => {
        const site = await enrolledSite();
        const first = await send(site, sample(site.agentId));
        expect(first.status).toBe(200);
        expect(await first.json()).toEqual({ interval_seconds: 60 });

        // Waktu, disk, dan angka feed finance berubah tanpa keadaan server berubah.
        expect(
            (
                await send(
                    site,
                    sample(site.agentId, {
                        disk: { data_free_bytes: 900, backup_free_bytes: 1900 },
                        finance_feed: null,
                    }),
                )
            ).status,
        ).toBe(200);
        expect(
            (await send(site, sample(site.agentId, { release: '0.9.2' })))
                .status,
        ).toBe(200);
        expect(await history(site.siteId)).toEqual([
            { release: '0.9.1' },
            { release: '0.9.2' },
        ]);
        const row = await db.one(
            z.object({
                reported_release: z.string(),
                last_seen_ip: z.string(),
                seen: z.boolean(),
            }),
            `select reported_release, last_seen_ip, last_seen_at is not null as seen from sites where id = $1`,
            [site.siteId],
        );
        expect(row).toEqual({
            reported_release: '0.9.2',
            last_seen_ip: address,
            seen: true,
        });
    });

    test('accepts the fields older agents leave out', async () => {
        const site = await enrolledSite();
        expect(
            (
                await send(site, {
                    site_id: site.agentId,
                    agent_version: '0.0.9',
                    created_at: '2026-11-09T05:00:00Z',
                    server_time: '2026-11-09T05:00:01+07:00',
                })
            ).status,
        ).toBe(200);
    });

    test('rejects unknown keys at any depth, loose booleans, and another site id', async () => {
        const site = await enrolledSite();
        const other = await enrolledSite();
        for (const body of [
            sample(site.agentId, { hostname: 'leaks.example.com' }),
            sample(site.agentId, {
                containers: [
                    { service: 'core-app', state: 'running', env: 'x' },
                ],
            }),
            sample(site.agentId, { license_required: 'true' }),
            sample(other.agentId),
        ]) {
            const response = await send(site, body);
            expect(response.status).toBe(422);
            expect(await response.json()).toEqual({ error: 'report_invalid' });
        }
    });

    test('refuses a revoked site like a bad signature', async () => {
        const site = await enrolledSite();
        await db.execute('update sites set revoked_at = now() where id = $1', [
            site.siteId,
        ]);
        const response = await send(site, sample(site.agentId));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'signature_invalid' });
    });
});
