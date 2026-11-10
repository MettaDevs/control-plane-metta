import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';

// Label yang dipakai layanan lain di domain yang sama; aturan alamat operations-metta menolaknya sebagai tenant.
const reservedLabels = new Set(['admin', 'www', 'api', 'registry']);

export const customerInputSchema = z.object({
    legal_name: z.string().trim().min(1).max(255),
    // Menjadi alamat `<slug>.<base>`, jadi bentuknya label DNS, dan tidak pernah dipakai ulang.
    slug: z
        .string()
        .regex(
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
            'Slug berisi huruf kecil, angka, dan tanda hubung, paling panjang 63.',
        )
        .refine(
            (slug) => !reservedLabels.has(slug),
            'Slug ini dipakai layanan lain.',
        ),
    admin: z.object({
        name: z.string().trim().min(1).max(255),
        email: z.email().max(255).toLowerCase(),
    }),
    environment: z.discriminatedUnion('kind', [
        z.object({
            kind: z.literal('production'),
            name: z.string().trim().min(1).max(100).default('Produksi'),
        }),
        // Lama trial tidak ditulis mati: operator menentukan kapan demo berakhir.
        z.object({
            kind: z.literal('demo'),
            name: z.string().trim().min(1).max(100).default('Demo'),
            expires_at: z.iso.date(),
        }),
    ]),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export type CreatedCustomer = {
    client_id: string;
    tenant_id: string;
    environment_id: string;
    operation_id: string;
    admin_email: string;
    // Ditampilkan sekali. Permintaan yang diulang dengan kunci yang sama tidak menampilkannya lagi.
    temporary_password: string | null;
};

const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!@#%';
function temporaryPassword(): string {
    return Array.from(
        { length: 20 },
        () => alphabet[randomInt(alphabet.length)],
    ).join('');
}

// Nama database lingkungan: dari slug dan jenisnya supaya mudah dikenali operator, ditambah potongan id supaya tidak
// pernah bertabrakan, dalam batas 63 karakter PostgreSQL.
function databaseName(slug: string, kind: string, environmentId: string) {
    const suffix = environmentId.replaceAll('-', '').slice(-10);
    return `env_${slug.replaceAll('-', '_')}_${kind}`
        .slice(0, 63 - suffix.length - 1)
        .concat('_', suffix);
}

const replaySchema = z.object({
    request_hash: z.string(),
    client_id: z.string(),
    tenant_id: z.string(),
    environment_id: z.string(),
    operation_id: z.string(),
});

// Customer baru lahir di sini: customer, tenant, lingkungan pertamanya, dan perintah penyiapan untuk worker
// operations, dalam satu transaksi. Pemilik tenant tercatat sebelum operations membuat apa pun. Admin pertama dibuat
// worker di database lingkungan dengan password sementara yang hash-nya dibawa parameter operasi.
export async function createCustomer(
    db: Database,
    actor: { operatorId: string; ipAddress: string | null },
    idempotencyKey: string,
    input: CustomerInput,
): Promise<CreatedCustomer> {
    const requestHash = createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex');
    return db.transaction(async () => {
        await db.execute('select pg_advisory_xact_lock(hashtext($1))', [
            `customer-creation:${idempotencyKey}`,
        ]);
        const replay = await db.one(
            replaySchema,
            'select request_hash, client_id, tenant_id, environment_id, operation_id from customer_creation_requests where idempotency_key = $1',
            [idempotencyKey],
        );
        if (replay) {
            if (replay.request_hash !== requestHash)
                throw new HttpFailure(422, {
                    error: 'idempotency_key_reused',
                    message:
                        'Kunci permintaan ini sudah dipakai untuk customer dengan isi berbeda.',
                });
            return {
                client_id: replay.client_id,
                tenant_id: replay.tenant_id,
                environment_id: replay.environment_id,
                operation_id: replay.operation_id,
                admin_email: input.admin.email,
                temporary_password: null,
            };
        }

        const ids = {
            client: Bun.randomUUIDv7(),
            tenant: Bun.randomUUIDv7(),
            environment: Bun.randomUUIDv7(),
            operation: Bun.randomUUIDv7(),
            admin: Bun.randomUUIDv7(),
        };
        const password = temporaryPassword();
        const database = databaseName(
            input.slug,
            input.environment.kind,
            ids.environment,
        );
        try {
            await db.execute(
                "insert into clients (id, legal_name, slug, status, created_at, updated_at) values ($1, $2, $3, 'active', now() at time zone 'utc', now() at time zone 'utc')",
                [ids.client, input.legal_name, input.slug],
            );
            await db.execute(
                "insert into tenants (id, client_id, name, slug, status, created_at, updated_at) values ($1, $2, $3, $4, 'active', now() at time zone 'utc', now() at time zone 'utc')",
                [ids.tenant, ids.client, input.legal_name, input.slug],
            );
        } catch (error) {
            if (sqlErrorCode(error) === '23505')
                throw new HttpFailure(422, {
                    error: 'slug_taken',
                    message:
                        'Slug ini sudah dipakai customer lain dan tidak bisa dipakai ulang.',
                });
            throw error;
        }
        await db.execute(
            `insert into environments (id, tenant_id, kind, name, slug, database_name, status, expires_at,
                outbound_allowed, hosting, created_by, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, 'provisioning', $7, $8, 'provider', $9, now() at time zone 'utc',
                now() at time zone 'utc')`,
            [
                ids.environment,
                ids.tenant,
                input.environment.kind,
                input.environment.name,
                input.environment.kind,
                database,
                input.environment.kind === 'demo'
                    ? input.environment.expires_at
                    : null,
                input.environment.kind === 'production',
                actor.operatorId,
            ],
        );
        // Bentuk parameter ini adalah permintaan penyiapan operations-metta (provisionRequestSchema).
        const parameters = {
            environment: {
                kind: input.environment.kind,
                name: input.environment.name,
            },
            database,
            client: {
                id: ids.client,
                legal_name: input.legal_name,
                slug: input.slug,
            },
            tenant: {
                id: ids.tenant,
                name: input.legal_name,
                slug: input.slug,
            },
            admin: {
                id: ids.admin,
                name: input.admin.name,
                email: input.admin.email,
                password_hash: await Bun.password.hash(password, {
                    algorithm: 'bcrypt',
                }),
            },
        };
        await db.execute(
            `insert into environment_operations (id, environment_id, operation, status, requested_by, parameters,
                requested_at)
             values ($1, $2, 'provision', 'requested', $3, $4::text::jsonb, now() at time zone 'utc')`,
            [
                ids.operation,
                ids.environment,
                actor.operatorId,
                JSON.stringify(parameters),
            ],
        );
        await db.execute(
            "insert into customer_creation_requests (idempotency_key, request_hash, client_id, tenant_id, environment_id, operation_id, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, now() at time zone 'utc')",
            [
                idempotencyKey,
                requestHash,
                ids.client,
                ids.tenant,
                ids.environment,
                ids.operation,
                actor.operatorId,
            ],
        );
        await recordAudit(db, {
            operatorId: actor.operatorId,
            action: 'customer.created',
            subjectType: 'tenant',
            subjectId: ids.tenant,
            detail: {
                slug: input.slug,
                environment_kind: input.environment.kind,
                environment_id: ids.environment,
            },
            ipAddress: actor.ipAddress,
        });
        return {
            client_id: ids.client,
            tenant_id: ids.tenant,
            environment_id: ids.environment,
            operation_id: ids.operation,
            admin_email: input.admin.email,
            temporary_password: password,
        };
    });
}

const customerRowSchema = z.object({
    client_id: z.string(),
    legal_name: z.string(),
    tenant_id: z.string(),
    slug: z.string(),
    environments: z.array(
        z.object({
            id: z.string(),
            kind: z.string(),
            name: z.string(),
            status: z.string(),
            expires_at: z.string().nullable(),
            operation: z
                .object({
                    id: z.string(),
                    operation: z.string(),
                    status: z.string(),
                    step: z.string().nullable(),
                    failure_message: z.string().nullable(),
                })
                .nullable(),
        }),
    ),
});

// Setiap customer dengan lingkungannya dan operasi terakhir tiap lingkungan, untuk layar daftar customer.
export async function listCustomers(db: Database) {
    return db.rows(
        customerRowSchema,
        `select c.id as client_id, c.legal_name, t.id as tenant_id, t.slug,
            coalesce((select json_agg(json_build_object(
                'id', e.id, 'kind', e.kind, 'name', e.name, 'status', e.status,
                'expires_at', to_char(e.expires_at, 'YYYY-MM-DD'),
                'operation', (select json_build_object('id', o.id, 'operation', o.operation, 'status', o.status,
                        'step', o.step, 'failure_message', o.failure_message)
                    from environment_operations o where o.environment_id = e.id
                    order by o.requested_at desc limit 1)) order by e.created_at)
                from environments e where e.tenant_id = t.id and e.deleted_at is null), '[]') as environments
         from clients c join tenants t on t.client_id = c.id
         order by c.legal_name, t.slug`,
    );
}
