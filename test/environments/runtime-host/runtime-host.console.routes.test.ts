import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { agentRouter } from '../../../src/agent.ts';
import { addRuntimeHost } from '../../../src/environments/index.ts';
import { Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { signedRequest, siteKeyPair } from '../../support/agent-client.ts';
import { consoleTestApp } from '../../support/console-app.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('runtime host console', () => {
    if (!process.env.DB_HOST) return;
    const { config, pool, call, sessionOf, close } = consoleTestApp(23);
    const agent = createApplication(config, agentRouter(config));
    const db = new Database(pool);
    const email = `hosts-${crypto.randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    afterAll(async () => {
        await db.release();
        await agent.close();
        await close();
    });

    const hostsSchema = z.object({
        runtime_hosts: z.array(
            z.object({
                id: z.string(),
                name: z.string(),
                fingerprint: z.string(),
                revoked_at: z.string().nullable(),
                environments: z.number(),
                open_operations: z.number(),
            }),
        ),
    });

    test('lists hosts with their fingerprint, and a revoked host is no longer heard', async () => {
        expect((await call('/api/v1/runtime-hosts')).status).toBe(401);
        await createOperator(
            db,
            { name: 'Operator Host', email, password },
            { operatorId: null, ipAddress: null },
        );
        const cookie = sessionOf(
            await call('/login', { method: 'POST', body: { email, password } }),
        );
        const keys = siteKeyPair();
        const name = `host-${crypto.randomUUID()}`;
        const host = await addRuntimeHost(db, {
            name,
            public_key: keys.publicKey,
        });
        // Laporan langkah untuk operasi yang tidak dipegang host ini: 409 selama tanda tangannya sah, 401 setelah host
        // dicabut. Tidak memakai claim, supaya test ini tidak mengambil operasi milik berkas test lain.
        const report = () =>
            agent.handle(
                signedRequest({
                    method: 'POST',
                    path: `/api/worker/v1/operations/${crypto.randomUUID()}/steps`,
                    body: { status: 'running', step: 'migrate' },
                    keyId: host.id,
                    privateKey: keys.privateKey,
                }),
                '198.51.100.9',
            );
        expect((await report()).status).toBe(409);

        const listed = hostsSchema.parse(
            await (await call('/api/v1/runtime-hosts', { cookie })).json(),
        );
        expect(
            listed.runtime_hosts.find((row) => row.id === host.id),
        ).toMatchObject({
            name,
            fingerprint: host.fingerprint,
            revoked_at: null,
        });

        const revoke = () =>
            call(`/api/v1/runtime-hosts/${host.id}/revoke`, {
                method: 'POST',
                cookie,
            });
        expect((await revoke()).status).toBe(204);
        expect((await revoke()).status).toBe(409);
        expect(
            (
                await call(
                    `/api/v1/runtime-hosts/${crypto.randomUUID()}/revoke`,
                    { method: 'POST', cookie },
                )
            ).status,
        ).toBe(404);
        expect((await report()).status).toBe(401);

        const after = hostsSchema.parse(
            await (await call('/api/v1/runtime-hosts', { cookie })).json(),
        );
        expect(
            after.runtime_hosts.find((row) => row.id === host.id)?.revoked_at,
        ).not.toBeNull();
        const audit = await pool.unsafe(
            "select action from operator_audit_events where subject_type = 'runtime_host' and subject_id = $1 order by id",
            [host.id],
        );
        expect(audit.map((row) => row.action)).toEqual([
            'runtime_host.added',
            'runtime_host.revoked',
        ]);
    });
});
