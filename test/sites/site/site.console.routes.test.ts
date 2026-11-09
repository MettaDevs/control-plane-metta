import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { agentRouter } from '../../../src/agent.ts';
import { Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { signedRequest } from '../../support/agent-client.ts';
import { consoleTestApp } from '../../support/console-app.ts';
import { createEnrolledSite, createSite } from '../../support/sites.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('site console', () => {
    if (!process.env.DB_HOST) return;
    const { config, pool, call, sessionOf, close } = consoleTestApp(13);
    const agent = createApplication(config, agentRouter);
    const db = new Database(pool);
    const email = `sites-${crypto.randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    afterAll(async () => {
        await db.release();
        await agent.close();
        await close();
    });

    async function signIn() {
        await createOperator(
            db,
            { name: 'Operator Situs', email, password },
            { operatorId: null, ipAddress: null },
        );
        return sessionOf(
            await call('/login', { method: 'POST', body: { email, password } }),
        );
    }

    test('lists sites, issues a token, requests and cancels operations, and revokes', async () => {
        expect((await call('/api/v1/sites')).status).toBe(401);
        const cookie = await signIn();
        const fresh = await createSite(db, { tenantName: 'Klinik Konsol' });
        const site = await createEnrolledSite(db, agent);

        const list = (await (
            await call('/api/v1/sites', { cookie })
        ).json()) as {
            sites: { id: string; state: string; tenant_name: string }[];
        };
        expect(list.sites.find((row) => row.id === fresh.siteId)).toMatchObject(
            { state: 'not_enrolled', tenant_name: 'Klinik Konsol' },
        );
        expect(list.sites.find((row) => row.id === site.siteId)?.state).toBe(
            'stale',
        );

        const issued = await call(
            `/api/v1/sites/${fresh.siteId}/enrollment-tokens`,
            { method: 'POST', body: {}, cookie },
        );
        expect(issued.status).toBe(201);
        const { token } = (await issued.json()) as { token: string };
        expect(token).toMatch(/^[A-Za-z0-9]{48}$/);

        const requested = await call(
            `/api/v1/sites/${site.siteId}/operations`,
            {
                method: 'POST',
                body: { operation: 'backup' },
                cookie,
            },
        );
        expect(requested.status).toBe(201);
        const { id } = (await requested.json()) as { id: string };
        const duplicate = await call(
            `/api/v1/sites/${site.siteId}/operations`,
            {
                method: 'POST',
                body: { operation: 'backup' },
                cookie,
            },
        );
        expect(duplicate.status).toBe(409);
        expect(await duplicate.json()).toMatchObject({
            error: 'operation_pending',
        });
        for (const operation of ['upgrade', 'install', 'install_license', 'x'])
            expect(
                (
                    await call(`/api/v1/sites/${site.siteId}/operations`, {
                        method: 'POST',
                        body: { operation },
                        cookie,
                    })
                ).status,
            ).toBe(422);
        expect(
            (
                await call(`/api/v1/sites/${fresh.siteId}/operations`, {
                    method: 'POST',
                    body: { operation: 'backup' },
                    cookie,
                })
            ).status,
        ).toBe(409);

        const cancel = () =>
            call(`/api/v1/sites/${site.siteId}/operations/${id}/cancel`, {
                method: 'POST',
                body: {},
                cookie,
            });
        expect((await cancel()).status).toBe(204);
        expect((await cancel()).status).toBe(409);

        expect(
            (
                await call(`/api/v1/sites/${site.siteId}/operations`, {
                    method: 'POST',
                    body: { operation: 'rotate_key' },
                    cookie,
                })
            ).status,
        ).toBe(201);
        const detail = (await (
            await call(`/api/v1/sites/${site.siteId}`, { cookie })
        ).json()) as {
            site: { operations: { operation: string; status: string }[] };
        };
        expect(
            detail.site.operations.map((row) => [row.operation, row.status]),
        ).toEqual([
            ['rotate_key', 'requested'],
            ['backup', 'cancelled'],
        ]);

        expect(
            (
                await call(`/api/v1/sites/${site.siteId}/revoke`, {
                    method: 'POST',
                    body: {},
                    cookie,
                })
            ).status,
        ).toBe(204);
        const report = await agent.handle(
            signedRequest({
                method: 'POST',
                path: '/api/agent/v1/report',
                keyId: site.agentId,
                privateKey: site.keys.privateKey,
                body: {
                    site_id: site.agentId,
                    agent_version: '0.1.0',
                    created_at: new Date().toISOString(),
                    server_time: new Date().toISOString(),
                },
            }),
        );
        expect(report.status).toBe(401);
        const statuses = await db.rows(
            z.object({ status: z.string() }),
            'select status from site_operations where site_id = $1 order by requested_at',
            [site.siteId],
        );
        expect(statuses.map((row) => row.status)).toEqual([
            'cancelled',
            'cancelled',
        ]);

        const audit = await db.rows(
            z.object({
                action: z.string(),
                detail: z.record(z.string(), z.unknown()),
            }),
            `select action, detail from operator_audit_events
             where subject_type = 'site' and subject_id in ($1, $2) order by id`,
            [fresh.siteId, site.siteId],
        );
        expect(audit.map((row) => row.action)).toEqual([
            'site.enrollment_token.issued',
            'site.operation.requested',
            'site.operation.cancelled',
            'site.operation.requested',
            'site.revoked',
        ]);
        expect(JSON.stringify(audit)).not.toContain(token);
        expect(audit.at(-1)?.detail).toEqual({ cancelled_operations: 1 });
    });
});
