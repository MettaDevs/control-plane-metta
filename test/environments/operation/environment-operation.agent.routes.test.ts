import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { agentRouter } from '../../../src/agent.ts';
import { createCustomer } from '../../../src/customers/customer/customer.service.ts';
import { addRuntimeHost } from '../../../src/environments/index.ts';
import {
    requestConversion,
    requestMigration,
    requestRestore,
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
        // Host yang belum pernah melapor tidak dipilih penempatan; fixture ini dianggap baru saja melapor.
        await db.execute(
            "update runtime_hosts set reported_at = now() at time zone 'utc' where id = $1",
            [id],
        );
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

    test('control plane menempatkan lingkungan ke host pilihan atau host aktif tersepi, dan host lain tidak mengambilnya', async () => {
        const chosen = await host();
        const bystander = await host();
        const actor = { operatorId: await operator(), ipAddress: null };
        const input = (slug: string, runtimeHostId?: string) => ({
            legal_name: 'PT Klinik Penempatan',
            slug,
            admin: { name: 'Admin', email: 'admin@penempatan.test' },
            environment: { kind: 'production' as const, name: 'Produksi' },
            ...(runtimeHostId ? { runtime_host_id: runtimeHostId } : {}),
        });
        const placed = await createCustomer(
            db,
            actor,
            crypto.randomUUID(),
            input(`tempat-${crypto.randomUUID().slice(-12)}`, chosen.id),
        );
        const state = async (environmentId: string, operationId: string) =>
            (
                await pool.unsafe(
                    'select e.runtime_host_id, o.status from environments e join environment_operations o on o.environment_id = e.id where e.id = $1 and o.id = $2',
                    [environmentId, operationId],
                )
            )[0];
        expect(
            await state(placed.environment_id, placed.operation_id),
        ).toMatchObject({ runtime_host_id: chosen.id, status: 'requested' });
        // Host lain boleh mengambil operasi lain di database test bersama, tetapi tidak pernah yang ini.
        for (let attempt = 0; attempt < 5; attempt++)
            await bystander.call('/api/worker/v1/operations/claim');
        expect(
            await state(placed.environment_id, placed.operation_id),
        ).toMatchObject({ status: 'requested' });
        const claimed = claimedSchema.parse(
            await (await chosen.call('/api/worker/v1/operations/claim')).json(),
        );
        expect(claimed.operation.id).toBe(placed.operation_id);

        const automatic = await createCustomer(
            db,
            actor,
            crypto.randomUUID(),
            input(`tempat-${crypto.randomUUID().slice(-12)}`),
        );
        const [fairness] = await pool.unsafe(
            `with load as (
                select h.id, (select count(*) from environments e
                              where e.runtime_host_id = h.id and e.purged_at is null and e.id <> $1) as environments
                from runtime_hosts h
                where h.revoked_at is null and not h.dedicated and h.accepts_new
                  and h.reported_at >= now() at time zone 'utc' - interval '15 minutes'
                  and (h.capacity is null or (select count(*) from environments e
                       where e.runtime_host_id = h.id and e.purged_at is null and e.id <> $1) < h.capacity)
             )
             select (select environments from load
                     where id = (select runtime_host_id from environments where id = $1)) as placed_load,
                    (select min(environments) from load) as lightest`,
            [automatic.environment_id],
        );
        expect(fairness?.placed_load).toBe(fairness?.lightest);

        await db.execute(
            "update runtime_hosts set revoked_at = now() at time zone 'utc' where id = $1",
            [bystander.id],
        );
        await expect(
            createCustomer(
                db,
                actor,
                crypto.randomUUID(),
                input(`tempat-${crypto.randomUUID().slice(-12)}`, bystander.id),
            ),
        ).rejects.toMatchObject({
            status: 422,
            body: { errors: { runtime_host_id: [expect.any(String)] } },
        });
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

    test('demo yang lewat tanggal diantrekan expire saat host meminta, gagal tidak mengubahnya, sukses menghapus lunak', async () => {
        const worker = await host();
        const actor = { operatorId: await operator(), ipAddress: null };
        const created = await createCustomer(db, actor, crypto.randomUUID(), {
            legal_name: 'PT Klinik Kedaluwarsa',
            slug: `expire-${crypto.randomUUID().slice(-12)}`,
            admin: { name: 'Admin', email: 'admin@expire.test' },
            environment: {
                kind: 'demo',
                name: 'Demo',
                expires_at: '2099-01-31',
            },
        });
        await db.execute(
            'update environments set runtime_host_id = $2 where id = $1',
            [created.environment_id, worker.id],
        );
        const claim = async () => {
            const response = await worker.call(
                '/api/worker/v1/operations/claim',
            );
            return response.status === 200
                ? z
                      .object({
                          operation: z.object({
                              id: z.string(),
                              operation: z.string(),
                              environment_id: z.string(),
                              parameters: z.record(z.string(), z.unknown()),
                          }),
                      })
                      .parse(await response.json()).operation
                : null;
        };
        // Host lain di database test yang sama boleh meninggalkan operasi yang belum terikat, jadi yang diperiksa adalah
        // antrean expire lingkungan ini, bukan apakah claim menjawab kosong.
        const expires = async () =>
            (
                await pool.unsafe(
                    "select count(*)::int as count from environment_operations where environment_id = $1 and operation = 'expire'",
                    [created.environment_id],
                )
            )[0]?.count;
        const close = (id: string, status: 'succeeded' | 'failed') =>
            worker.call(`/api/worker/v1/operations/${id}/steps`, {
                status,
                step: status === 'succeeded' ? 'done' : 'failed',
                ...(status === 'failed'
                    ? { failure_message: 'alamat demo menunjuk database lain' }
                    : {}),
            });
        const provision = await claim();
        expect(provision?.operation).toBe('provision');
        await close(provision!.id, 'succeeded');
        // Belum lewat tanggalnya: tidak ada yang diantrekan.
        await claim();
        expect(await expires()).toBe(0);

        await db.execute(
            "update environments set expires_at = now() at time zone 'utc' - interval '1 day' where id = $1",
            [created.environment_id],
        );
        const failing = await claim();
        expect(failing).toMatchObject({
            operation: 'expire',
            environment_id: created.environment_id,
        });
        const [tenant] = await pool.unsafe(
            'select t.slug, e.database_name from environments e join tenants t on t.id = e.tenant_id where e.id = $1',
            [created.environment_id],
        );
        expect(failing?.parameters).toEqual({
            tenant_slug: tenant?.slug,
            database: tenant?.database_name,
        });
        await close(failing!.id, 'failed');
        const [afterFailure] = await pool.unsafe(
            'select status, deleted_at is null as live from environments where id = $1',
            [created.environment_id],
        );
        expect({ ...afterFailure }).toEqual({ status: 'active', live: true });
        // Baru gagal: tidak diantrekan ulang dalam sejam.
        await claim();
        expect(await expires()).toBe(1);

        await db.execute(
            "update environment_operations set finished_at = finished_at - interval '2 hours' where id = $1",
            [failing!.id],
        );
        const retry = await claim();
        expect(retry?.operation).toBe('expire');
        await close(retry!.id, 'succeeded');
        const [deleted] = await pool.unsafe(
            `select e.status, e.deleted_at is not null as deleted,
                round(extract(epoch from e.purge_after - e.deleted_at) / 86400)::int as grace_days,
                o.detail ->> 'previous_status' as previous_status
             from environments e join environment_operations o on o.environment_id = e.id
             where o.id = $1`,
            [retry!.id],
        );
        expect({ ...deleted }).toEqual({
            status: 'soft_deleted',
            deleted: true,
            grace_days: 30,
            previous_status: 'active',
        });
        await claim();
        expect(await expires()).toBe(2);
    });

    test('restore menyalakan lagi demo yang dihapus selama masa tenggang, dengan status lama dan tanggal berakhir baru', async () => {
        const worker = await host();
        const actor = { operatorId: await operator(), ipAddress: null };
        const created = await createCustomer(db, actor, crypto.randomUUID(), {
            legal_name: 'PT Klinik Pulih',
            slug: `restore-${crypto.randomUUID().slice(-12)}`,
            admin: { name: 'Admin', email: 'admin@restore.test' },
            environment: {
                kind: 'demo',
                name: 'Demo',
                expires_at: '2099-01-31',
            },
        });
        const environmentId = created.environment_id;
        await db.execute(
            'update environments set runtime_host_id = $2 where id = $1',
            [environmentId, worker.id],
        );
        const operationSchema = z.object({
            operation: z.object({
                id: z.string(),
                operation: z.string(),
                environment_id: z.string(),
                parameters: z.record(z.string(), z.unknown()),
            }),
        });
        // Operasi lingkungan ini yang diambil host; operasi tinggalan berkas test lain diabaikan.
        const claimOwn = async () => {
            for (let attempt = 0; attempt < 20; attempt++) {
                const response = await worker.call(
                    '/api/worker/v1/operations/claim',
                );
                if (response.status !== 200) break;
                const { operation } = operationSchema.parse(
                    await response.json(),
                );
                if (operation.environment_id === environmentId)
                    return operation;
            }
            throw new Error('Operasi lingkungan ini tidak diambil.');
        };
        const close = (id: string, status: 'succeeded' | 'failed') =>
            worker.call(`/api/worker/v1/operations/${id}/steps`, {
                status,
                step: status === 'succeeded' ? 'done' : 'failed',
                ...(status === 'failed'
                    ? { failure_message: 'alamat demo tidak tercatat' }
                    : {}),
            });
        const refused = (expiresAt?: string) =>
            requestRestore(db, actor, environmentId, expiresAt).then(
                () => null,
                (error: unknown) =>
                    z.object({ status: z.number() }).parse(error).status,
            );
        await close((await claimOwn()).id, 'succeeded');
        expect(await refused('2099-12-31')).toBe(409);

        await db.execute(
            "update environments set expires_at = now() at time zone 'utc' - interval '1 day' where id = $1",
            [environmentId],
        );
        const expire = await claimOwn();
        expect(expire.operation).toBe('expire');
        await close(expire.id, 'succeeded');

        expect(await refused()).toBe(422);
        expect(await refused('2000-01-01')).toBe(422);
        const failing = await requestRestore(
            db,
            actor,
            environmentId,
            '2099-12-31',
        );
        expect(await refused('2099-12-31')).toBe(409);
        const claimed = await claimOwn();
        expect(claimed).toMatchObject({
            id: failing.id,
            operation: 'restore',
            parameters: { kind: 'demo' },
        });
        expect(Object.keys(claimed.parameters).sort()).toEqual([
            'database',
            'kind',
            'tenant_slug',
        ]);
        await close(failing.id, 'failed');
        const state = async () => {
            const [row] = await pool.unsafe(
                `select status, deleted_at is null as live, purge_after is null as kept,
                    to_char(expires_at, 'YYYY-MM-DD') as expires_at
                 from environments where id = $1`,
                [environmentId],
            );
            return { ...row };
        };
        expect(await state()).toMatchObject({
            status: 'soft_deleted',
            live: false,
        });

        const restoring = await requestRestore(
            db,
            actor,
            environmentId,
            '2099-12-31',
        );
        expect((await claimOwn()).id).toBe(restoring.id);
        await close(restoring.id, 'succeeded');
        expect(await state()).toEqual({
            status: 'active',
            live: true,
            kept: true,
            expires_at: '2099-12-31',
        });
        expect(await refused('2099-12-31')).toBe(409);

        // Masa tenggang yang habis tidak bisa dipulihkan.
        await db.execute(
            `update environments set status = 'soft_deleted', deleted_at = now() at time zone 'utc' - interval '31 days',
                purge_after = now() at time zone 'utc' - interval '1 day' where id = $1`,
            [environmentId],
        );
        expect(await refused('2099-12-31')).toBe(409);
    });

    test('purge diantrekan setelah masa tenggang habis, tidak pernah untuk produksi, dan sukses mencatat nisannya', async () => {
        const worker = await host();
        const actor = { operatorId: await operator(), ipAddress: null };
        const demo = await createCustomer(db, actor, crypto.randomUUID(), {
            legal_name: 'PT Klinik Buang',
            slug: `purge-${crypto.randomUUID().slice(-12)}`,
            admin: { name: 'Admin', email: 'admin@purge.test' },
            environment: {
                kind: 'demo',
                name: 'Demo',
                expires_at: '2099-01-31',
            },
        });
        const production = await customer(worker.id);
        const environmentId = demo.environment_id;
        await db.execute(
            'update environments set runtime_host_id = $2 where id = $1',
            [environmentId, worker.id],
        );
        const own = new Set([environmentId, production.environment_id]);
        const operationSchema = z.object({
            operation: z.object({
                id: z.string(),
                operation: z.string(),
                environment_id: z.string(),
                parameters: z.record(z.string(), z.unknown()),
            }),
        });
        // Operasi lingkungan test ini yang diambil host; operasi tinggalan berkas test lain diabaikan.
        const claimOwn = async () => {
            for (let attempt = 0; attempt < 20; attempt++) {
                const response = await worker.call(
                    '/api/worker/v1/operations/claim',
                );
                if (response.status !== 200) return null;
                const { operation } = operationSchema.parse(
                    await response.json(),
                );
                if (own.has(operation.environment_id)) return operation;
            }
            return null;
        };
        const close = (id: string, status: 'succeeded' | 'failed') =>
            worker.call(`/api/worker/v1/operations/${id}/steps`, {
                status,
                step: status === 'succeeded' ? 'done' : 'failed',
                ...(status === 'failed'
                    ? {
                          failure_message:
                              'database masih ditunjuk alamat aktif',
                      }
                    : {}),
            });
        const purges = async (id: string) =>
            (
                await pool.unsafe(
                    "select count(*)::int as count from environment_operations where environment_id = $1 and operation = 'purge'",
                    [id],
                )
            )[0]?.count;
        for (let opened = 0; opened < 2; opened++) {
            const provision = await claimOwn();
            expect(provision?.operation).toBe('provision');
            await close(provision!.id, 'succeeded');
        }

        await db.execute(
            "update environments set expires_at = now() at time zone 'utc' - interval '1 day' where id = $1",
            [environmentId],
        );
        const expire = await claimOwn();
        expect(expire?.operation).toBe('expire');
        await close(expire!.id, 'succeeded');
        // Masih dalam masa tenggang.
        await claimOwn();
        expect(await purges(environmentId)).toBe(0);

        // Tenggang habis, dan produksi yang dihapus lunak dengan tenggang habis ikut disiapkan sebagai pembanding.
        await db.execute(
            `update environments set purge_after = now() at time zone 'utc' - interval '1 hour' where id = $1`,
            [environmentId],
        );
        await db.execute(
            `update environments set status = 'soft_deleted', deleted_at = now() at time zone 'utc' - interval '40 days',
                purge_after = now() at time zone 'utc' - interval '10 days' where id = $1`,
            [production.environment_id],
        );
        const failing = await claimOwn();
        expect(failing).toMatchObject({
            operation: 'purge',
            environment_id: environmentId,
        });
        const [registered] = await pool.unsafe(
            'select t.slug, e.database_name from environments e join tenants t on t.id = e.tenant_id where e.id = $1',
            [environmentId],
        );
        expect(failing?.parameters).toEqual({
            tenant_slug: registered?.slug,
            kind: 'demo',
            database: registered?.database_name,
        });
        await close(failing!.id, 'failed');
        const purged = async () =>
            (
                await pool.unsafe(
                    'select purged_at is not null as purged, status from environments where id = $1',
                    [environmentId],
                )
            )[0];
        expect(await purged()).toMatchObject({
            purged: false,
            status: 'soft_deleted',
        });

        await db.execute(
            "update environment_operations set finished_at = finished_at - interval '2 hours' where id = $1",
            [failing!.id],
        );
        const retry = await claimOwn();
        expect(retry?.operation).toBe('purge');
        await close(retry!.id, 'succeeded');
        expect(await purged()).toMatchObject({
            purged: true,
            status: 'soft_deleted',
        });
        await claimOwn();
        expect(await purges(environmentId)).toBe(2);
        expect(await purges(production.environment_id)).toBe(0);
    });

    test('laporan host menyimpan rilis dan keadaan lingkungan milik host itu saja', async () => {
        const worker = await host();
        const other = await host();
        const mine = await customer(worker.id);
        const theirs = await customer(other.id);
        const [names] = await pool.unsafe(
            `select
                (select database_name from environments where id = $1) as mine,
                (select database_name from environments where id = $2) as theirs,
                (select t.slug from environments e join tenants t on t.id = e.tenant_id where e.id = $1) as slug`,
            [mine.environment_id, theirs.environment_id],
        );
        const entry = (database: string, healthy: boolean) => ({
            tenant_slug: names?.slug,
            kind: 'production',
            database,
            healthy,
            problem: healthy ? null : 'Database tidak bisa dibuka.',
            size_bytes: 1234,
            migrations: { core: '0013_environment_route_disabled.sql' },
        });
        const response = await worker.call('/api/worker/v1/report', {
            release: '0.3.0',
            environments: [
                entry(names?.mine, true),
                entry(names?.theirs, false),
                entry('env_tidak_dikenal', true),
            ],
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ matched: 1, unknown: 2 });
        const [state] = await pool.unsafe(
            `select
                (select reported_release from runtime_hosts where id = $1) as release,
                (select reported_healthy from environments where id = $2) as mine,
                (select reported_size_bytes from environments where id = $2) as size,
                (select reported_migrations ->> 'core' from environments where id = $2) as core,
                (select reported_at is null from environments where id = $3) as theirs_untouched`,
            [worker.id, mine.environment_id, theirs.environment_id],
        );
        expect({ ...state }).toEqual({
            release: '0.3.0',
            mine: true,
            size: '1234',
            core: '0013_environment_route_disabled.sql',
            theirs_untouched: true,
        });
        expect(
            (await worker.call('/api/worker/v1/report', { release: '' }))
                .status,
        ).toBe(422);
    });

    test('penempatan menolak host yang tidak menerima, penuh, atau tidak melapor, dan host khusus hanya lewat pilihan langsung', async () => {
        const actor = { operatorId: await operator(), ipAddress: null };
        const input = (runtimeHostId?: string) => ({
            legal_name: 'PT Klinik Pengaturan Host',
            slug: `atur-${crypto.randomUUID().slice(-12)}`,
            admin: { name: 'Admin', email: 'admin@atur.test' },
            environment: { kind: 'production' as const, name: 'Produksi' },
            ...(runtimeHostId ? { runtime_host_id: runtimeHostId } : {}),
        });
        const reason = (runtimeHostId: string) =>
            createCustomer(
                db,
                actor,
                crypto.randomUUID(),
                input(runtimeHostId),
            ).then(
                () => null,
                (error: unknown) =>
                    z
                        .object({
                            body: z.object({
                                errors: z.object({
                                    runtime_host_id: z.array(z.string()),
                                }),
                            }),
                        })
                        .parse(error).body.errors.runtime_host_id[0],
            );
        const paused = await host();
        await db.execute(
            'update runtime_hosts set accepts_new = false where id = $1',
            [paused.id],
        );
        expect(await reason(paused.id)).toContain('tidak menerima');

        const full = await host();
        await db.execute(
            'update runtime_hosts set capacity = 1 where id = $1',
            [full.id],
        );
        expect(await reason(full.id)).toBeNull();
        expect(await reason(full.id)).toContain('kapasitas');

        const silent = await host();
        await db.execute(
            "update runtime_hosts set reported_at = now() at time zone 'utc' - interval '1 hour' where id = $1",
            [silent.id],
        );
        expect(await reason(silent.id)).toContain('tidak melapor');

        // Host khusus yang paling sepi tetap tidak dipilih penempatan otomatis, tetapi boleh dipilih langsung.
        const dedicated = await host();
        await host();
        await db.execute(
            'update runtime_hosts set dedicated = true where id = $1',
            [dedicated.id],
        );
        const automatic = await createCustomer(
            db,
            actor,
            crypto.randomUUID(),
            input(),
        );
        const placedOn = async (environmentId: string) =>
            (
                await pool.unsafe(
                    'select runtime_host_id from environments where id = $1',
                    [environmentId],
                )
            )[0]?.runtime_host_id;
        for (const excluded of [paused.id, full.id, silent.id, dedicated.id])
            expect(await placedOn(automatic.environment_id)).not.toBe(excluded);
        expect(await reason(dedicated.id)).toBeNull();
    });
});
