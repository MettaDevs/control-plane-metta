import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { agentRouter } from '../../../src/agent.ts';
import { createCustomer } from '../../../src/customers/customer/customer.service.ts';
import { addRuntimeHost } from '../../../src/environments/index.ts';
import {
    requestConversion,
    requestMigration,
} from '../../../src/environments/operation/environment-operation.service.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { signedRequest, siteKeyPair } from '../../support/agent-client.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('worker environment queue', () => {
    if (!process.env.DB_HOST) return;
    const config = loadConfig({
        ...process.env,
        APP_KEY: 'base64:' + Buffer.alloc(32, 21).toString('base64'),
    });
    const app = createApplication(config, agentRouter(config));
    const pool = createPool(config);
    const db = new Database(pool);
    afterAll(async () => {
        await db.release();
        await app.close();
        await pool.end();
    });

    let operatorId: string | undefined;
    async function operator() {
        operatorId ??= (
            await createOperator(
                db,
                {
                    name: 'Operator Worker',
                    email: `worker-${crypto.randomUUID()}@example.com`,
                    password: 'correct horse battery staple',
                },
                { operatorId: null, ipAddress: null },
            )
        ).id;
        return operatorId;
    }
    async function host() {
        const keys = siteKeyPair();
        const { id } = await addRuntimeHost(db, {
            name: `host-${crypto.randomUUID()}`,
            public_key: keys.publicKey,
        });
        const call = (path: string, body: unknown = {}) =>
            app.handle(
                signedRequest({
                    method: 'POST',
                    path,
                    body,
                    keyId: id,
                    privateKey: keys.privateKey,
                }),
                '198.51.100.7',
            );
        return { id, call };
    }
    // Customer dengan lingkungan produksi dan operasi provision yang menunggu worker, terikat ke host bila disebut,
    // supaya test tidak berebut operasi yang ditinggalkan berkas test lain.
    async function customer(boundTo?: string) {
        const created = await createCustomer(
            db,
            { operatorId: await operator(), ipAddress: null },
            crypto.randomUUID(),
            {
                legal_name: 'PT Klinik Worker',
                slug: `worker-${crypto.randomUUID().slice(-12)}`,
                admin: { name: 'Admin', email: 'admin@worker.test' },
                environment: { kind: 'production', name: 'Produksi' },
            },
        );
        if (boundTo)
            await db.execute(
                'update environments set runtime_host_id = $2 where id = $1',
                [created.environment_id, boundTo],
            );
        return created;
    }
    const claimedSchema = z.object({
        operation: z.object({
            id: z.string(),
            operation: z.literal('provision'),
            environment_id: z.string(),
            lease_until: z.string(),
            parameters: z.object({
                database: z.string(),
                admin: z.object({ password_hash: z.string() }),
            }),
        }),
    });
    async function state(environmentId: string, operationId: string) {
        const [row] = await pool.unsafe(
            `select e.status as environment, e.runtime_host_id, e.schema_migrated_at is not null as migrated,
                o.status as operation, o.step, o.failure_message, o.parameters -> 'admin' ? 'password_hash' as has_hash
             from environments e join environment_operations o on o.environment_id = e.id
             where e.id = $1 and o.id = $2`,
            [environmentId, operationId],
        );
        return { ...row };
    }

    test('tanpa tanda tangan sah atau dari host yang tidak dikenal ditolak', async () => {
        const unsigned = await app.handle(
            new Request('http://localhost/api/worker/v1/operations/claim', {
                method: 'POST',
                body: '{}',
            }),
            '198.51.100.7',
        );
        expect(unsigned.status).toBe(401);
        const keys = siteKeyPair();
        const unknown = await app.handle(
            signedRequest({
                method: 'POST',
                path: '/api/worker/v1/operations/claim',
                body: {},
                keyId: crypto.randomUUID(),
                privateKey: keys.privateKey,
            }),
            '198.51.100.7',
        );
        expect(unknown.status).toBe(401);
        expect(await unknown.json()).toEqual({ error: 'signature_invalid' });
    });

    test('host mengambil operasi, memperpanjang tenggat, lalu penutupan sukses mengaktifkan lingkungan', async () => {
        const worker = await host();
        const created = await customer(worker.id);
        const claim = await worker.call('/api/worker/v1/operations/claim');
        expect(claim.status).toBe(200);
        expect(claim.headers.get('cache-control')).toBe('no-store');
        const { operation } = claimedSchema.parse(await claim.json());
        expect(operation.id).toBe(created.operation_id);
        expect(
            await Bun.password.verify(
                created.temporary_password!,
                operation.parameters.admin.password_hash,
            ),
        ).toBe(true);

        const running = await worker.call(
            `/api/worker/v1/operations/${operation.id}/steps`,
            { status: 'running', step: 'migrate' },
        );
        expect(running.status).toBe(200);
        const renewed = (await running.json()) as { lease_until: string };
        expect(Date.parse(renewed.lease_until)).toBeGreaterThan(Date.now());

        const done = await worker.call(
            `/api/worker/v1/operations/${operation.id}/steps`,
            { status: 'succeeded', step: 'record-route' },
        );
        expect(await done.json()).toEqual({ lease_until: null });
        expect(
            await state(created.environment_id, created.operation_id),
        ).toEqual({
            environment: 'active',
            runtime_host_id: worker.id,
            migrated: true,
            operation: 'succeeded',
            step: 'record-route',
            failure_message: null,
            has_hash: false,
        });
        expect(
            (
                await worker.call(
                    `/api/worker/v1/operations/${operation.id}/steps`,
                    { status: 'running', step: 'late' },
                )
            ).status,
        ).toBe(409);
    });

    test('host lain tidak bisa mengambil atau melapor untuk lingkungan yang terikat ke host pertama', async () => {
        const first = await host();
        const other = await host();
        const created = await customer(first.id);
        const { operation } = claimedSchema.parse(
            await (await first.call('/api/worker/v1/operations/claim')).json(),
        );
        expect(operation.id).toBe(created.operation_id);
        const stolen = await other.call(
            `/api/worker/v1/operations/${operation.id}/steps`,
            { status: 'succeeded', step: 'done' },
        );
        expect(stolen.status).toBe(409);
        expect(await stolen.json()).toEqual({ error: 'operation_not_held' });
        expect(
            (await state(created.environment_id, created.operation_id))
                .operation,
        ).toBe('running');
    });

    test('penutupan gagal membuat lingkungan degraded dan membuang hash password', async () => {
        const worker = await host();
        const created = await customer(worker.id);
        await worker.call('/api/worker/v1/operations/claim');
        const failed = await worker.call(
            `/api/worker/v1/operations/${created.operation_id}/steps`,
            {
                status: 'failed',
                step: 'create-database',
                failure_message: 'disk penuh',
            },
        );
        expect(failed.status).toBe(200);
        expect(
            await state(created.environment_id, created.operation_id),
        ).toMatchObject({
            environment: 'degraded',
            operation: 'failed',
            failure_message: 'disk penuh',
            has_hash: false,
        });
    });

    test('tenggat yang lewat: worker lama ditolak, dan pembacaan antrean berikutnya menutupnya gagal', async () => {
        const worker = await host();
        const created = await customer(worker.id);
        await worker.call('/api/worker/v1/operations/claim');
        await db.execute(
            "update environment_operations set lease_until = (now() at time zone 'utc') - interval '1 minute' where id = $1",
            [created.operation_id],
        );
        const late = await worker.call(
            `/api/worker/v1/operations/${created.operation_id}/steps`,
            { status: 'succeeded', step: 'done' },
        );
        expect(late.status).toBe(409);
        await worker.call('/api/worker/v1/operations/claim');
        expect(
            await state(created.environment_id, created.operation_id),
        ).toMatchObject({
            environment: 'degraded',
            operation: 'failed',
            has_hash: false,
        });
    });

    test('lingkungan yang belum terikat diikat ke host pertama yang mengambil operasinya', async () => {
        const worker = await host();
        const claim = await worker.call('/api/worker/v1/operations/claim');
        // Antrean bersama di database test bisa berisi operasi dari berkas test lain; yang diperiksa adalah ikatannya.
        if (claim.status === 204) {
            const created = await customer();
            const retry = claimedSchema.parse(
                await (
                    await worker.call('/api/worker/v1/operations/claim')
                ).json(),
            );
            expect(retry.operation.id).toBe(created.operation_id);
        }
        const [bound] = await pool.unsafe(
            "select count(*)::int as count from environment_operations o join environments e on e.id = o.environment_id where o.status = 'running' and e.runtime_host_id = $1",
            [worker.id],
        );
        expect(bound?.count).toBe(1);
    });

    test('migrate hanya untuk lingkungan yang sudah disiapkan, diambil host lingkungannya, dan ditutup seperti penyiapan', async () => {
        const worker = await host();
        const created = await customer(worker.id);
        const actor = { operatorId: await operator(), ipAddress: null };
        const refused = (promise: Promise<unknown>) =>
            promise.then(
                () => null,
                (error: unknown) =>
                    z.object({ status: z.number() }).parse(error).status,
            );
        expect(
            await refused(requestMigration(db, actor, created.environment_id)),
        ).toBe(409);
        expect(
            await refused(requestMigration(db, actor, crypto.randomUUID())),
        ).toBe(404);

        const provision = claimedSchema.parse(
            await (await worker.call('/api/worker/v1/operations/claim')).json(),
        ).operation;
        await worker.call(`/api/worker/v1/operations/${provision.id}/steps`, {
            status: 'succeeded',
            step: 'done',
        });

        const migrateSchema = z.object({
            operation: z.object({
                id: z.string(),
                operation: z.literal('migrate'),
                environment_id: z.string(),
                parameters: z.strictObject({ database: z.string() }),
            }),
        });
        const first = await requestMigration(db, actor, created.environment_id);
        expect(
            await refused(requestMigration(db, actor, created.environment_id)),
        ).toBe(409);
        const claimed = migrateSchema.parse(
            await (await worker.call('/api/worker/v1/operations/claim')).json(),
        ).operation;
        expect(claimed).toMatchObject({
            id: first.id,
            environment_id: created.environment_id,
            parameters: { database: provision.parameters.database },
        });
        await worker.call(`/api/worker/v1/operations/${first.id}/steps`, {
            status: 'failed',
            step: 'failed',
            failure_message: 'relation already exists',
        });
        expect(await state(created.environment_id, first.id)).toMatchObject({
            environment: 'degraded',
            operation: 'failed',
        });

        const second = await requestMigration(
            db,
            actor,
            created.environment_id,
        );
        migrateSchema.parse(
            await (await worker.call('/api/worker/v1/operations/claim')).json(),
        );
        await worker.call(`/api/worker/v1/operations/${second.id}/steps`, {
            status: 'succeeded',
            step: 'done',
        });
        expect(await state(created.environment_id, second.id)).toMatchObject({
            environment: 'active',
            operation: 'succeeded',
            migrated: true,
        });
        const [audit] = await pool.unsafe(
            "select detail from operator_audit_events where action = 'environment.operation.requested' and subject_id = $1 order by id desc limit 1",
            [created.environment_id],
        );
        expect(audit?.detail).toEqual({
            operation_id: second.id,
            operation: 'migrate',
        });
    });

    test('convert hanya untuk demo aktif tanpa produksi, mengubah jenisnya saat sukses, dan gagal tetap active', async () => {
        const worker = await host();
        const actor = { operatorId: await operator(), ipAddress: null };
        const refused = (promise: Promise<unknown>) =>
            promise.then(
                () => null,
                (error: unknown) =>
                    z
                        .object({ body: z.object({ error: z.string() }) })
                        .parse(error).body.error,
            );
        const demo = async () => {
            const created = await createCustomer(
                db,
                actor,
                crypto.randomUUID(),
                {
                    legal_name: 'PT Klinik Demo',
                    slug: `demo-${crypto.randomUUID().slice(-12)}`,
                    admin: { name: 'Admin', email: 'admin@demo.test' },
                    environment: {
                        kind: 'demo',
                        name: 'Demo',
                        expires_at: '2099-01-31',
                    },
                },
            );
            await db.execute(
                'update environments set runtime_host_id = $2 where id = $1',
                [created.environment_id, worker.id],
            );
            return created;
        };
        const close = (id: string, status: 'succeeded' | 'failed') =>
            worker.call(`/api/worker/v1/operations/${id}/steps`, {
                status,
                step: status === 'succeeded' ? 'done' : 'failed',
                ...(status === 'failed'
                    ? { failure_message: 'alamat produksi sudah dipakai' }
                    : {}),
            });
        const convertSchema = z.object({
            operation: z.object({
                id: z.string(),
                operation: z.literal('convert'),
                parameters: z.strictObject({
                    tenant_slug: z.string(),
                    database: z.string().nullable(),
                    name: z.string(),
                }),
            }),
        });

        const created = await demo();
        expect(
            await refused(requestConversion(db, actor, created.environment_id)),
        ).toBe('environment_not_active');
        const provision = z
            .object({ operation: z.object({ id: z.string() }) })
            .parse(
                await (
                    await worker.call('/api/worker/v1/operations/claim')
                ).json(),
            ).operation;
        await close(provision.id, 'succeeded');

        const failing = await requestConversion(
            db,
            actor,
            created.environment_id,
        );
        expect(
            await refused(requestConversion(db, actor, created.environment_id)),
        ).toBe('operation_pending');
        const claimed = convertSchema.parse(
            await (await worker.call('/api/worker/v1/operations/claim')).json(),
        ).operation;
        expect(claimed.id).toBe(failing.id);
        expect(claimed.parameters.name).toBe('Produksi');
        await close(failing.id, 'failed');
        const [afterFailure] = await pool.unsafe(
            'select kind, status, expires_at is not null as expires from environments where id = $1',
            [created.environment_id],
        );
        expect({ ...afterFailure }).toEqual({
            kind: 'demo',
            status: 'active',
            expires: true,
        });

        const converting = await requestConversion(
            db,
            actor,
            created.environment_id,
        );
        convertSchema.parse(
            await (await worker.call('/api/worker/v1/operations/claim')).json(),
        );
        await close(converting.id, 'succeeded');
        const [converted] = await pool.unsafe(
            'select kind, slug, name, status, outbound_allowed, expires_at from environments where id = $1',
            [created.environment_id],
        );
        expect({ ...converted }).toEqual({
            kind: 'production',
            slug: 'production',
            name: 'Produksi',
            status: 'active',
            outbound_allowed: true,
            expires_at: null,
        });
        expect(
            await refused(requestConversion(db, actor, created.environment_id)),
        ).toBe('environment_not_demo');
    });

    test('convert ditolak bila tenant sudah punya produksi, dan penutupan yang kalah balapan ditutup gagal', async () => {
        const worker = await host();
        const actor = { operatorId: await operator(), ipAddress: null };
        const created = await customer(worker.id);
        await worker.call(
            `/api/worker/v1/operations/${
                z
                    .object({ operation: z.object({ id: z.string() }) })
                    .parse(
                        await (
                            await worker.call('/api/worker/v1/operations/claim')
                        ).json(),
                    ).operation.id
            }/steps`,
            { status: 'succeeded', step: 'done' },
        );
        const environmentId = Bun.randomUUIDv7();
        await db.execute(
            `insert into environments (id, tenant_id, kind, name, slug, database_name, status, expires_at,
                outbound_allowed, hosting, runtime_host_id, schema_migrated_at, created_at, updated_at)
             values ($1, $2, 'demo', 'Uji coba', 'demo', null, 'active', now() + interval '30 days', false, 'provider',
                $3, now(), now(), now())`,
            [environmentId, created.tenant_id, worker.id],
        );
        await expect(
            requestConversion(db, actor, environmentId),
        ).rejects.toMatchObject({ body: { error: 'production_exists' } });

        // Produksi lama dihapus lunak, konversi diminta, lalu produksi lain muncul sebelum worker menutupnya.
        await db.execute(
            "update environments set deleted_at = now(), purge_after = now() + interval '30 days', status = 'soft_deleted' where id = $1",
            [created.environment_id],
        );
        const converting = await requestConversion(db, actor, environmentId);
        const claimed = z
            .object({
                operation: z.object({
                    id: z.string(),
                    parameters: z.object({ name: z.string() }),
                }),
            })
            .parse(
                await (
                    await worker.call('/api/worker/v1/operations/claim')
                ).json(),
            ).operation;
        expect(claimed).toMatchObject({
            id: converting.id,
            parameters: { name: 'Uji coba' },
        });
        await db.execute(
            'update environments set deleted_at = null, purge_after = null, status = $2 where id = $1',
            [created.environment_id, 'active'],
        );
        await worker.call(`/api/worker/v1/operations/${converting.id}/steps`, {
            status: 'succeeded',
            step: 'done',
        });
        const [row] = await pool.unsafe(
            `select e.kind, e.status, o.status as operation, o.failure_message
             from environments e join environment_operations o on o.environment_id = e.id
             where o.id = $1`,
            [converting.id],
        );
        expect(row).toMatchObject({
            kind: 'demo',
            status: 'active',
            operation: 'failed',
        });
        expect(row?.failure_message).toContain('produksi lain');
    });
});
