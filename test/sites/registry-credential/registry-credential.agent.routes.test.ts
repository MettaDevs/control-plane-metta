import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { agentRouter } from '../../../src/agent.ts';
import { consoleRouter } from '../../../src/console.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import {
    RegistryUnavailable,
    storeSystemRobot,
} from '../../../src/releases/index.ts';
import { fromAgentId } from '../../../src/sites/index.ts';
import { signedRequest } from '../../support/agent-client.ts';
import { HarborStub } from '../../support/harbor.ts';
import { createEnrolledSite } from '../../support/sites.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('registry credentials for agents', () => {
    if (!process.env.DB_HOST) return;
    const harbor = HarborStub.start();
    const config = loadConfig({
        ...process.env,
        APP_KEY: 'base64:' + Buffer.alloc(32, 16).toString('base64'),
        SESSION_SECURE_COOKIE: 'false',
        CONSOLE_REGISTRY_HOST: 'registry.example.com',
        CONSOLE_REGISTRY_API_URL: harbor.url,
        CONSOLE_REGISTRY_PROJECT: harbor.project,
    });
    const agent = createApplication(config, agentRouter(config));
    const console_ = createApplication(config, consoleRouter(config));
    const pool = createPool(config);
    const db = new Database(pool);
    afterAll(async () => {
        await db.release();
        await agent.close();
        await console_.close();
        await pool.end();
        harbor.stop();
    });

    type Site = Awaited<ReturnType<typeof createEnrolledSite>>;
    const signed = (site: Site, path: string, body: unknown) =>
        agent.handle(
            signedRequest({
                method: 'POST',
                path,
                keyId: site.agentId,
                privateKey: site.keys.privateKey,
                body,
            }),
            '198.51.100.9',
        );
    const credential = (site: Site, operationId: string) =>
        signed(site, '/api/agent/v1/registry-credential', {
            operation_id: operationId,
        });
    async function claimed(site: Site, operation: string) {
        await db.execute(
            `insert into site_operations (id, site_id, operation, parameters, status, requested_at, expires_at,
                                          created_at, updated_at)
             values ($1, $2, $3, '{"edition":"coreerp","release":"1.0.0"}'::jsonb, 'requested', now(),
                     now() + interval '7 days', now(), now())`,
            [Bun.randomUUIDv7(), site.siteId, operation],
        );
        const response = await signed(
            site,
            '/api/agent/v1/operations/claim',
            {},
        );
        return ((await response.json()) as { id: string }).id;
    }
    const robotOf = (siteId: string) =>
        db.rows(
            z.object({ robot: z.string().nullable() }),
            'select registry_robot_name as robot from site_operations where site_id = $1',
            [siteId],
        );

    test('stores the system robot only after Harbor accepts it', async () => {
        await expect(
            storeSystemRobot(db, config, {
                name: 'robot$console',
                secret: 'wrong',
            }),
        ).rejects.toBeInstanceOf(RegistryUnavailable);
        await storeSystemRobot(db, config, harbor.systemRobot);
        const stored = await db.one(
            z.object({ value: z.string() }),
            "select value from console_settings where key = 'registry.robot'",
        );
        expect(stored?.value).not.toContain('system-secret');
    });

    test('issues one pull robot per held operation, replaces it on request, and deletes it when the operation closes', async () => {
        const site = await createEnrolledSite(db, agent);
        const id = await claimed(site, 'upgrade');
        const first = await credential(site, id);
        expect(first.status).toBe(200);
        expect(first.headers.get('cache-control')).toBe('no-store');
        const body = (await first.json()) as Record<string, string>;
        expect(body).toMatchObject({ registry: 'registry.example.com' });
        expect(body.username).toStartWith(
            `robot$coreerp+situs-${id.toLowerCase()}-`,
        );
        expect(body.expires_at).toMatch(/\+00:00$/);
        const robot = [...harbor.robots.values()].find(
            (entry) => entry.name === body.username,
        );
        expect(robot).toMatchObject({ project: 'coreerp', action: 'pull' });

        const second = (await (await credential(site, id)).json()) as {
            username: string;
        };
        expect(second.username).not.toBe(body.username);
        expect(harbor.robots.has(robot!.id)).toBe(false);
        expect(await robotOf(site.siteId)).toEqual([
            { robot: second.username },
        ]);

        await signed(site, `/api/agent/v1/operations/${id}/steps`, {
            status: 'succeeded',
            step: 'Selesai',
        });
        expect(await robotOf(site.siteId)).toEqual([{ robot: null }]);
        expect(
            [...harbor.robots.values()].some(
                (entry) => entry.name === second.username,
            ),
        ).toBe(false);
        const audit = await db.rows(
            z.object({ action: z.string(), reason: z.string().nullable() }),
            `select action, detail->>'reason' as reason from operator_audit_events
             where subject_type = 'site' and subject_id = $1 order by id`,
            [site.siteId],
        );
        expect(audit).toEqual([
            { action: 'site.registry_robot.issued', reason: null },
            { action: 'site.registry_robot.deleted', reason: 'diganti' },
            { action: 'site.registry_robot.issued', reason: null },
            {
                action: 'site.registry_robot.deleted',
                reason: 'operasi_ditutup',
            },
        ]);
        expect((await credential(site, id)).status).toBe(409);
    });

    test('refuses operations that do not pull, and answers 503 when Harbor fails', async () => {
        const site = await createEnrolledSite(db, agent);
        const backup = await claimed(site, 'backup');
        expect(await (await credential(site, backup)).json()).toEqual({
            error: 'operation_not_held',
        });
        await signed(site, `/api/agent/v1/operations/${backup}/steps`, {
            status: 'succeeded',
            step: 'Selesai',
        });
        const install = await claimed(site, 'install');
        harbor.failCreate = true;
        try {
            const failed = await credential(site, install);
            expect(failed.status).toBe(503);
            expect(await failed.json()).toEqual({
                error: 'registry_unavailable',
            });
        } finally {
            harbor.failCreate = false;
        }
        expect((await credential(site, 'x'.repeat(40))).status).toBe(422);
    });

    test('deletes the robot of an expired lease on the next claim, and of a running operation when the site is revoked', async () => {
        const site = await createEnrolledSite(db, agent);
        const expired = await claimed(site, 'upgrade');
        const robot = (await (await credential(site, expired)).json()) as {
            username: string;
        };
        await db.execute(
            "update site_operations set lease_until = now() at time zone 'utc' - interval '1 minute' where id = $1",
            [fromAgentId(expired)],
        );
        await signed(site, '/api/agent/v1/operations/claim', {});
        expect(
            [...harbor.robots.values()].some(
                (entry) => entry.name === robot.username,
            ),
        ).toBe(false);

        const running = await claimed(site, 'upgrade');
        const held = (await (await credential(site, running)).json()) as {
            username: string;
        };
        const email = `registry-${crypto.randomUUID()}@example.com`;
        await createOperator(
            db,
            {
                name: 'Operator Registry',
                email,
                password: 'correct horse battery staple',
            },
            { operatorId: null, ipAddress: null },
        );
        const login = await console_.handle(
            new Request('http://localhost/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password: 'correct horse battery staple',
                }),
            }),
            '203.0.113.31',
        );
        const cookie = login.headers.getSetCookie()[0]?.split(';')[0] ?? '';
        const revoked = await console_.handle(
            new Request(`http://localhost/api/v1/sites/${site.siteId}/revoke`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', cookie },
                body: '{}',
            }),
            '203.0.113.31',
        );
        expect(revoked.status).toBe(204);
        expect(
            [...harbor.robots.values()].some(
                (entry) => entry.name === held.username,
            ),
        ).toBe(false);
        const reason = await db.one(
            z.object({ reason: z.string() }),
            `select detail->>'reason' as reason from operator_audit_events
             where subject_id = $1 and action = 'site.registry_robot.deleted' order by id desc limit 1`,
            [site.siteId],
        );
        expect(reason?.reason).toBe('situs_dicabut');
    });
});
