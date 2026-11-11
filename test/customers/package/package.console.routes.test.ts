import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';
import { createCustomer } from '../../../src/customers/customer/customer.service.ts';
import { grantEntitlement } from '../../../src/customers/entitlement/entitlement.service.ts';
import { addRuntimeHost } from '../../../src/environments/index.ts';
import { Database } from '../../../src/platform/database/index.ts';
import { createOperator } from '../../../src/platform/operator-identity/index.ts';
import { consoleTestApp } from '../../support/console-app.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('susunan module', () => {
    if (!process.env.DB_HOST) return;
    const { pool, call, sessionOf, close } = consoleTestApp(18);
    const db = new Database(pool);
    const password = 'correct horse battery staple';
    afterAll(async () => {
        await db.release();
        await close();
    });

    async function setup() {
        const email = `packages-${crypto.randomUUID()}@example.com`;
        const operator = await createOperator(
            db,
            { name: 'Operator Susunan', email, password },
            { operatorId: null, ipAddress: null },
        );
        const cookie = sessionOf(
            await call('/login', {
                method: 'POST',
                body: { email, password },
            }),
        );
        const host = await addRuntimeHost(db, {
            name: `host-susunan-${crypto.randomUUID()}`,
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
        const modules = [1, 2, 3].map(
            (n) => `uji-${String(n)}-${crypto.randomUUID().slice(-8)}`,
        );
        for (const id of modules)
            await db.execute(
                `insert into catalog_modules (id, name, description, first_reported_at, last_reported_at)
                 values ($1, $1, null, now(), now())`,
                [id],
            );
        const created = await createCustomer(
            db,
            { operatorId: operator.id, ipAddress: null },
            crypto.randomUUID(),
            {
                legal_name: 'PT Klinik Susunan',
                slug: `susunan-${crypto.randomUUID().slice(-12)}`,
                admin: { name: 'Admin', email: 'admin@susunan.test' },
                environment: { kind: 'production', name: 'Produksi' },
            },
        );
        const tenantId = z
            .string()
            .parse(
                (
                    await pool.unsafe(
                        'select tenant_id from environments where id = $1',
                        [created.environment_id],
                    )
                )[0]?.tenant_id,
            );
        return { cookie, operatorId: operator.id, modules, tenantId };
    }
    const errorsOf = async (response: Response) =>
        Object.keys(
            z
                .object({ errors: z.record(z.string(), z.unknown()) })
                .parse(await response.json()).errors,
        );

    test('susunan module diberikan ke tenant tanpa mengubah module yang sudah dimiliki', async () => {
        const { cookie, operatorId, modules, tenantId } = await setup();
        const [first, second, third] = modules as [string, string, string];
        const name = `Klinik ${crypto.randomUUID().slice(-8)}`;
        const create = (body: unknown) =>
            call('/api/v1/catalog/packages', { method: 'POST', cookie, body });

        const unknown = await create({
            name,
            description: null,
            module_ids: [first, 'tidak-ada'],
        });
        expect(unknown.status).toBe(422);
        expect(await errorsOf(unknown)).toEqual(['module_ids']);
        expect(
            await errorsOf(
                await create({ name: '', description: null, module_ids: [] }),
            ),
        ).toEqual(['name', 'module_ids']);

        const created = await create({
            name,
            description: 'Untuk klinik.',
            module_ids: [second, first, first],
        });
        expect(created.status).toBe(201);
        const { id } = z.object({ id: z.string() }).parse(await created.json());
        const duplicate = await create({
            name: name.toUpperCase(),
            description: null,
            module_ids: [first],
        });
        expect(await errorsOf(duplicate)).toEqual(['name']);

        const updated = await call(`/api/v1/catalog/packages/${id}`, {
            method: 'PUT',
            cookie,
            body: { name, description: null, module_ids: [first, third] },
        });
        expect(updated.status).toBe(204);

        // Module pertama sudah dimiliki dengan tanggal berakhirnya sendiri; hanya yang ketiga ditambahkan.
        await grantEntitlement(db, { operatorId, ipAddress: null }, tenantId, {
            module_id: first,
            ends_on: '2099-01-31',
        });
        const granted = await call(`/api/v1/tenants/${tenantId}/packages`, {
            method: 'POST',
            cookie,
            body: { package_id: id, ends_on: '2099-12-31' },
        });
        expect(granted.status).toBe(201);
        expect(await granted.json()).toEqual({ granted: [third] });
        const rows = z
            .array(z.object({ module_id: z.string(), ends_on: z.string() }))
            .parse(
                await pool.unsafe(
                    `select module_id, to_char(ends_on, 'YYYY-MM-DD') as ends_on from tenant_module_entitlements
                     where tenant_id = $1 and deleted_at is null order by module_id`,
                    [tenantId],
                ),
            );
        expect(rows).toEqual(
            [
                { module_id: first, ends_on: '2099-01-31' },
                { module_id: third, ends_on: '2099-12-31' },
            ].sort((a, b) => a.module_id.localeCompare(b.module_id)),
        );

        const removed = await call(`/api/v1/catalog/packages/${id}`, {
            method: 'DELETE',
            cookie,
        });
        expect(removed.status).toBe(204);
        const listed = z
            .object({ packages: z.array(z.object({ id: z.string() })) })
            .parse(
                await (
                    await call('/api/v1/catalog/packages', { cookie })
                ).json(),
            );
        expect(listed.packages.map((pack) => pack.id)).not.toContain(id);
        const afterDelete = await call(`/api/v1/tenants/${tenantId}/packages`, {
            method: 'POST',
            cookie,
            body: { package_id: id, ends_on: null },
        });
        expect(await errorsOf(afterDelete)).toEqual(['package_id']);
        const [audit] = await pool.unsafe(
            `select array_agg(action order by action) as actions from operator_audit_events
             where subject_id in ($1, $2) and action like any (array['catalog.package_%', 'tenant.package_%'])`,
            [id, tenantId],
        );
        // occurred_at tercatat per detik, jadi yang diperiksa himpunannya, bukan urutannya.
        expect(audit?.actions).toEqual([
            'catalog.package_changed',
            'catalog.package_created',
            'catalog.package_deleted',
            'tenant.package_entitled',
        ]);
    });
});
