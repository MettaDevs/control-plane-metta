import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { agentRouter } from '../../../src/agent.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { signedRequest } from '../../support/agent-client.ts';
import { createEnrolledSite } from '../../support/sites.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('site operation queue', () => {
    if (!process.env.DB_HOST) return;
    const config = loadConfig({
        ...process.env,
        APP_KEY: 'base64:' + Buffer.alloc(32, 12).toString('base64'),
    });
    const agent = createApplication(config, agentRouter(config));
    const pool = createPool(config);
    const db = new Database(pool);
    afterAll(async () => {
        await db.release();
        await agent.close();
        await pool.end();
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
            '198.51.100.7',
        );
    const claim = (site: Site, body: unknown = {}) =>
        signed(site, '/api/agent/v1/operations/claim', body);
    const step = (site: Site, id: string, body: unknown) =>
        signed(site, `/api/agent/v1/operations/${id}/steps`, body);

    async function queue(
        siteId: string,
        operation: string,
        parameters: Record<string, unknown> = {},
    ) {
        const id = Bun.randomUUIDv7();
        await db.execute(
            `insert into site_operations (id, site_id, operation, parameters, status, requested_at, expires_at,
                                          created_at, updated_at)
             values ($1, $2, $3, $4::text::jsonb, 'requested', now() at time zone 'utc' - interval '1 second' * $5,
                     now() at time zone 'utc' + interval '7 days', now(), now())`,
            [
                id,
                siteId,
                operation,
                JSON.stringify(parameters),
                100 - (await count(siteId)),
            ],
        );
        return id;
    }
    const count = async (siteId: string) =>
        (
            await db.one(
                z.object({ n: z.coerce.number() }),
                'select count(*) as n from site_operations where site_id = $1',
                [siteId],
            )
        )?.n ?? 0;
    const row = (id: string) =>
        db.one(
            z.object({
                status: z.string(),
                step: z.string().nullable(),
                failure_message: z.string().nullable(),
                parameters: z.record(z.string(), z.unknown()),
            }),
            'select status, step, failure_message, parameters from site_operations where id = $1',
            [id],
        );

    test('hands out the oldest operation once, and tracks its steps until it closes', async () => {
        const site = await createEnrolledSite(db, agent);
        const empty = await claim(site);
        expect(empty.status).toBe(204);
        expect(await empty.text()).toBe('');
        expect((await claim(site, { extra: true })).status).toBe(422);

        const first = await queue(site.siteId, 'backup');
        await queue(site.siteId, 'send_diagnostics');
        const claimed = await claim(site);
        expect(claimed.status).toBe(200);
        const body = (await claimed.json()) as {
            id: string;
            operation: string;
            parameters: object;
            lease_until: string;
        };
        expect(body.operation).toBe('backup');
        expect(body.parameters).toEqual({});
        expect(body.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
        expect(body.lease_until).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/,
        );
        // Satu situs, satu operasi berjalan.
        expect((await claim(site)).status).toBe(204);

        const running = await step(site, body.id, {
            status: 'running',
            step: 'Membuat cadangan database',
        });
        expect(running.status).toBe(200);
        expect(
            ((await running.json()) as { lease_until: string }).lease_until,
        ).toMatch(/\+00:00$/);
        const done = await step(site, body.id, {
            status: 'succeeded',
            step: 'Cadangan selesai',
        });
        expect(await done.json()).toEqual({ lease_until: null });
        expect(await row(first)).toMatchObject({
            status: 'succeeded',
            step: 'Cadangan selesai',
        });
        const late = await step(site, body.id, {
            status: 'running',
            step: 'Masih jalan',
        });
        expect(late.status).toBe(409);
        expect(await late.json()).toEqual({ error: 'operation_not_held' });
        expect(
            (await step(site, body.id, { status: 'paused', step: 'x' })).status,
        ).toBe(422);

        const next = (await (await claim(site)).json()) as { id: string };
        const failed = await step(site, next.id, {
            status: 'failed',
            step: 'Mengirim diagnosa',
        });
        expect(failed.status).toBe(200);
        const closed = await db.one(
            z.object({ failure_message: z.string() }),
            "select failure_message from site_operations where site_id = $1 and operation = 'send_diagnostics'",
            [site.siteId],
        );
        expect(closed?.failure_message).toBe(
            'Agen melaporkan gagal tanpa menyebut sebabnya.',
        );
    });

    test('fails an operation whose lease lapsed so the queue moves on', async () => {
        const site = await createEnrolledSite(db, agent);
        const stuck = await queue(site.siteId, 'backup');
        await queue(site.siteId, 'rotate_key');
        const claimed = (await (await claim(site)).json()) as { id: string };
        await db.execute(
            "update site_operations set lease_until = now() at time zone 'utc' - interval '1 minute' where id = $1",
            [stuck],
        );
        expect(
            (await step(site, claimed.id, { status: 'running', step: 'x' }))
                .status,
        ).toBe(409);
        const next = (await (await claim(site)).json()) as {
            operation: string;
        };
        expect(next.operation).toBe('rotate_key');
        expect(await row(stuck)).toMatchObject({
            status: 'failed',
            failure_message:
                'Tenggat habis: agen berhenti melapor sebelum operasi selesai. Periksa keadaan server sebelum meminta ulang.',
        });
    });

    test('waits for the update window and for an install release, without blocking others', async () => {
        const site = await createEnrolledSite(db, agent);
        await db.execute(
            `update sites set timezone = 'UTC',
                update_window_start = ((now() at time zone 'utc') + interval '2 hours')::time(0),
                update_window_end = ((now() at time zone 'utc') + interval '3 hours')::time(0)
             where id = $1`,
            [site.siteId],
        );
        await queue(site.siteId, 'upgrade', {
            edition: 'coreerp',
            release: '1.0.0',
        });
        await queue(site.siteId, 'install', { edition: 'coreerp' });
        const backup = await queue(site.siteId, 'backup');
        const claimed = (await (await claim(site)).json()) as {
            operation: string;
            id: string;
        };
        expect(claimed.operation).toBe('backup');
        await step(site, claimed.id, { status: 'succeeded', step: 'Selesai' });
        expect((await row(backup))?.status).toBe('succeeded');
        expect((await claim(site)).status).toBe(204);

        await db.execute(
            'update sites set update_window_start = null, update_window_end = null where id = $1',
            [site.siteId],
        );
        expect(
            ((await (await claim(site)).json()) as { operation: string })
                .operation,
        ).toBe('upgrade');
    });

    test('drops the admin password hash when an install closes', async () => {
        const site = await createEnrolledSite(db, agent);
        const install = await queue(site.siteId, 'install', {
            edition: 'coreerp',
            release: '1.0.0',
            admin_password_hash: '$2y$12$' + 'a'.repeat(53),
        });
        const claimed = (await (await claim(site)).json()) as {
            id: string;
            parameters: Record<string, unknown>;
        };
        expect(claimed.parameters.admin_password_hash).toBeDefined();
        await step(site, claimed.id, {
            status: 'succeeded',
            step: 'Terpasang',
        });
        expect((await row(install))?.parameters).toEqual({
            edition: 'coreerp',
            release: '1.0.0',
        });
    });

    test('refuses steps for another site and records who requested', async () => {
        const site = await createEnrolledSite(db, agent);
        const other = await createEnrolledSite(db, agent);
        await queue(site.siteId, 'backup');
        const claimed = (await (await claim(site)).json()) as { id: string };
        const foreign = await step(other, claimed.id, {
            status: 'succeeded',
            step: 'x',
        });
        expect(foreign.status).toBe(409);
        const operator = await createOperator(
            db,
            {
                name: 'Operator Situs',
                email: `site-${crypto.randomUUID()}@example.com`,
                password: 'correct horse battery staple',
            },
            { operatorId: null, ipAddress: null },
        );
        // requested_by kini menunjuk operators, bukan users.
        await db.execute(
            'update site_operations set requested_by = $2 where id = (select id from site_operations where site_id = $1 limit 1)',
            [site.siteId, operator.id],
        );
    });
});
