import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { Database } from '../../../src/platform/database/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { consoleTestApp } from '../../support/console-app.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('customer console', () => {
    if (!process.env.DB_HOST) return;
    const { pool, call, sessionOf, close } = consoleTestApp(17);
    const db = new Database(pool);
    const email = `customers-${crypto.randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    afterAll(async () => {
        await db.release();
        await close();
    });

    let signedIn: string | undefined;
    async function signIn() {
        if (signedIn) return signedIn;
        await createOperator(
            db,
            { name: 'Operator Customer', email, password },
            { operatorId: null, ipAddress: null },
        );
        signedIn = sessionOf(
            await call('/login', { method: 'POST', body: { email, password } }),
        );
        return signedIn;
    }

    const slug = () => `klinik-${crypto.randomUUID().slice(-12)}`;
    const body = (customerSlug: string, environment: object) => ({
        legal_name: 'PT Klinik Uji Konsol',
        slug: customerSlug,
        admin: { name: 'Admin Klinik', email: 'Admin@Klinik-Uji.test' },
        environment,
    });
    async function create(payload: unknown, key = crypto.randomUUID()) {
        return call('/api/v1/customers', {
            method: 'POST',
            body: payload,
            cookie: await signIn(),
            headers: { 'idempotency-key': key },
        });
    }
    const created = z.object({
        client_id: z.uuid(),
        tenant_id: z.uuid(),
        environment_id: z.uuid(),
        operation_id: z.uuid(),
        admin_email: z.string(),
        temporary_password: z.string().nullable(),
    });

    test('customer, tenant, lingkungan, dan perintah penyiapan lahir dalam satu permintaan', async () => {
        expect(
            (
                await call('/api/v1/customers', {
                    method: 'POST',
                    body: body(slug(), { kind: 'production' }),
                })
            ).status,
        ).toBe(401);
        const customerSlug = slug();
        const response = await create(
            body(customerSlug, { kind: 'production' }),
        );
        expect(response.status).toBe(201);
        const result = created.parse(await response.json());
        expect(result.admin_email).toBe('admin@klinik-uji.test');
        expect(result.temporary_password).toHaveLength(20);

        const [environment] = await pool.unsafe(
            'select e.kind, e.status, e.database_name, e.outbound_allowed, e.created_by is not null as has_creator, t.slug, t.client_id from environments e join tenants t on t.id = e.tenant_id where e.id = $1',
            [result.environment_id],
        );
        expect(environment).toMatchObject({
            kind: 'production',
            status: 'provisioning',
            outbound_allowed: true,
            has_creator: true,
            slug: customerSlug,
            client_id: result.client_id,
        });
        expect(environment?.database_name).toMatch(
            /^env_klinik_[a-f0-9_]+_production_[a-f0-9]{10}$/,
        );

        const [operation] = await pool.unsafe(
            'select operation, status, started_at, parameters from environment_operations where id = $1',
            [result.operation_id],
        );
        expect(operation).toMatchObject({
            operation: 'provision',
            status: 'requested',
            started_at: null,
        });
        const parameters = operation?.parameters as {
            environment: { kind: string; name: string };
            database: string;
            tenant: { id: string; slug: string };
            admin: { email: string; password_hash: string };
        };
        expect(parameters.environment).toEqual({
            kind: 'production',
            name: 'Produksi',
        });
        expect(parameters.database).toBe(environment?.database_name);
        expect(parameters.tenant).toMatchObject({
            id: result.tenant_id,
            slug: customerSlug,
        });
        expect(
            await Bun.password.verify(
                result.temporary_password!,
                parameters.admin.password_hash,
            ),
        ).toBe(true);

        const audit = await pool.unsafe(
            "select detail from operator_audit_events where action = 'customer.created' and subject_id = $1",
            [result.tenant_id],
        );
        expect(audit).toHaveLength(1);
        expect(JSON.stringify(audit[0]?.detail)).not.toContain(
            result.temporary_password!,
        );

        const list = (await (
            await call('/api/v1/customers', { cookie: await signIn() })
        ).json()) as {
            customers: {
                slug: string;
                environments: {
                    status: string;
                    operation: { status: string } | null;
                }[];
            }[];
        };
        const listed = list.customers.find(
            (customer) => customer.slug === customerSlug,
        );
        expect(listed?.environments).toHaveLength(1);
        expect(listed?.environments[0]).toMatchObject({
            status: 'provisioning',
            operation: { status: 'requested' },
        });
    });

    test('permintaan yang diulang dengan kunci yang sama menemukan customer pertama tanpa password', async () => {
        const key = crypto.randomUUID();
        const payload = body(slug(), { kind: 'production' });
        const first = created.parse(await (await create(payload, key)).json());
        const again = await create(payload, key);
        expect(again.status).toBe(201);
        expect(created.parse(await again.json())).toEqual({
            ...first,
            temporary_password: null,
        });
        const [count] = await pool.unsafe(
            'select count(*)::int as count from tenants where slug = $1',
            [payload.slug],
        );
        expect(count?.count).toBe(1);

        const different = await create(
            body(slug(), { kind: 'production' }),
            key,
        );
        expect(different.status).toBe(422);
        expect(await different.json()).toMatchObject({
            error: 'idempotency_key_reused',
        });
    });

    test('demo membawa tanggal berakhir dari operator dan tidak boleh mengirim keluar', async () => {
        const result = created.parse(
            await (
                await create(
                    body(slug(), { kind: 'demo', expires_at: '2026-12-31' }),
                )
            ).json(),
        );
        const [environment] = await pool.unsafe(
            "select kind, name, outbound_allowed, to_char(expires_at, 'YYYY-MM-DD') as expires_at from environments where id = $1",
            [result.environment_id],
        );
        expect({ ...environment }).toEqual({
            kind: 'demo',
            name: 'Demo',
            outbound_allowed: false,
            expires_at: '2026-12-31',
        });
        expect((await create(body(slug(), { kind: 'demo' }))).status).not.toBe(
            201,
        );
    });

    test('slug yang sudah dipakai, slug cadangan, dan tanpa kunci permintaan ditolak tanpa menulis apa pun', async () => {
        const taken = slug();
        await create(body(taken, { kind: 'production' }));
        const again = await create(body(taken, { kind: 'production' }));
        expect(again.status).toBe(422);
        expect(await again.json()).toMatchObject({ error: 'slug_taken' });

        expect(
            (await create(body('admin', { kind: 'production' }))).status,
        ).not.toBe(201);

        const withoutKey = slug();
        const missing = await call('/api/v1/customers', {
            method: 'POST',
            body: body(withoutKey, { kind: 'production' }),
            cookie: await signIn(),
        });
        expect(missing.status).toBe(422);
        const [count] = await pool.unsafe(
            "select count(*)::int as count from tenants where slug in ($1, 'admin')",
            [withoutKey],
        );
        expect(count?.count).toBe(0);
    });

    test('isian yang salah dijawab 422 dengan pesan per field untuk layar', async () => {
        const reserved = await create(body('admin', { kind: 'production' }));
        expect(reserved.status).toBe(422);
        expect(await reserved.json()).toEqual({
            message: 'Periksa isian customer baru.',
            errors: { slug: ['Slug ini dipakai layanan lain.'] },
        });

        const empty = await create({
            legal_name: ' ',
            slug: 'Bukan Slug',
            admin: { name: '', email: 'bukan-email' },
            environment: { kind: 'demo' },
        });
        expect(empty.status).toBe(422);
        const { errors } = z
            .object({ errors: z.record(z.string(), z.array(z.string())) })
            .parse(await empty.json());
        expect(errors).toEqual({
            legal_name: ['Isi nama badan usaha.'],
            slug: [
                'Slug berisi huruf kecil, angka, dan tanda hubung, paling panjang 63.',
            ],
            'admin.name': ['Isi nama admin.'],
            'admin.email': ['Isi alamat email yang benar.'],
            'environment.expires_at': ['Isi tanggal berakhir demo.'],
        });

        const nothing = await create({});
        expect(nothing.status).toBe(422);
        expect(
            Object.keys(
                z
                    .object({ errors: z.record(z.string(), z.unknown()) })
                    .parse(await nothing.json()).errors,
            ).sort(),
        ).toEqual(['admin', 'environment', 'legal_name', 'slug']);
    });
});
