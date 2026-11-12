import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import {
    desiredEntitlements,
    placeEnvironment,
} from '../../environments/index.ts';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';

// Label yang dipakai layanan lain di domain yang sama; aturan alamat operations-metta menolaknya sebagai tenant.
const reservedLabels = new Set(['admin', 'www', 'api', 'registry']);

// Pesan di sini tampil di layar customer baru, di bawah field asalnya.
const required = (message: string) => ({ error: message });

export const customerInputSchema = z.object({
    legal_name: z
        .string(required('Isi nama tenant.'))
        .trim()
        .min(1, 'Isi nama tenant.')
        .max(255, 'Nama tenant paling panjang 255 karakter.'),
    // Menjadi alamat `<slug>.<base>`, jadi bentuknya label DNS, dan tidak pernah dipakai ulang.
    slug: z
        .string(required('Isi slug.'))
        .regex(
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
            'Slug berisi huruf kecil, angka, dan tanda hubung, paling panjang 63.',
        )
        .refine(
            (slug) => !reservedLabels.has(slug),
            'Slug ini dipakai layanan lain.',
        ),
    admin: z.object(
        {
            name: z
                .string(required('Isi nama admin.'))
                .trim()
                .min(1, 'Isi nama admin.')
                .max(255, 'Nama admin paling panjang 255 karakter.'),
            email: z
                .email('Isi alamat email yang benar.')
                .max(255, 'Email paling panjang 255 karakter.')
                .toLowerCase(),
        },
        required('Isi data admin pertama.'),
    ),
    environment: z.discriminatedUnion(
        'kind',
        [
            z.object({
                kind: z.literal('production'),
                name: z.string().trim().min(1).max(100).default('Produksi'),
            }),
            // Lama trial tidak ditulis mati: operator menentukan kapan demo berakhir, atau mengosongkannya untuk demo
            // tanpa batas waktu.
            z.object({
                kind: z.literal('demo'),
                name: z.string().trim().min(1).max(100).default('Demo'),
                expires_at: z.iso
                    .date('Isi tanggal dengan format yang benar.')
                    .nullable()
                    .default(null),
            }),
        ],
        required('Pilih lingkungan pertama: produksi atau demo.'),
    ),
    // Host runtime tempat lingkungan pertama ditempatkan. Kosong berarti control plane memilih sendiri.
    runtime_host_id: z.uuid('Pilih host runtime dari daftar.').optional(),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

// Kesalahan isian per field, dengan nama field bertitik seperti `admin.email`, untuk jawaban 422.
export function customerInputErrors(
    error: z.ZodError,
): Record<string, string[]> {
    const errors: Record<string, string[]> = {};
    for (const issue of error.issues) {
        const field = issue.path.join('.') || '_form';
        (errors[field] ??= []).push(issue.message);
    }
    return errors;
}

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

        const runtimeHostId = await placeEnvironment(db, input.runtime_host_id);
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
            // first_admin_user_id: id pengguna klinik admin pertama, yang dibuat worker dari parameter provision. Undangan
            // admin menautkan akun SSO penerimanya ke pengguna ini.
            await db.execute(
                "insert into tenants (id, client_id, name, slug, status, first_admin_user_id, created_at, updated_at) values ($1, $2, $3, $4, 'active', $5, now() at time zone 'utc', now() at time zone 'utc')",
                [
                    ids.tenant,
                    ids.client,
                    input.legal_name,
                    input.slug,
                    ids.admin,
                ],
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
                outbound_allowed, hosting, runtime_host_id, created_by, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, 'provisioning', $7, $8, 'provider', $10, $9, now() at time zone 'utc',
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
                runtimeHostId,
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

export const environmentKindSchema = z.enum(['production', 'sandbox', 'demo']);
export const environmentStatusSchema = z.enum([
    'provisioning',
    'copying',
    'active',
    'maintenance',
    'degraded',
    'suspended',
    'soft_deleted',
]);
export const operationNameSchema = z.enum([
    'provision',
    'migrate',
    'convert',
    'expire',
    'restore',
    'purge',
    'sync_entitlements',
    'sync_identities',
]);
export const operationStatusSchema = z.enum([
    'requested',
    'running',
    'succeeded',
    'failed',
]);

const customerRowSchema = z.object({
    client_id: z.string(),
    legal_name: z.string(),
    tenant_id: z.string(),
    slug: z.string(),
    environments: z.array(
        z.object({
            id: z.string(),
            kind: environmentKindSchema,
            name: z.string(),
            status: environmentStatusSchema,
            expires_at: z.string().nullable(),
            operation: z
                .object({
                    id: z.string(),
                    operation: operationNameSchema,
                    status: operationStatusSchema,
                    step: z.string().nullable(),
                    failure_message: z.string().nullable(),
                })
                .nullable(),
        }),
    ),
});

// Setiap customer dengan lingkungannya dan operasi terakhir tiap lingkungan, untuk layar daftar customer. Lingkungan
// yang dihapus lunak ikut tampil sampai isinya dibuang, karena masih bisa dipulihkan.
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
                from environments e where e.tenant_id = t.id and e.purged_at is null), '[]') as environments
         from clients c join tenants t on t.client_id = c.id
         order by c.legal_name, t.slug`,
    );
}

const iso = (column: string) =>
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

const customerDetailSchema = z.object({
    client_id: z.string(),
    legal_name: z.string(),
    slug: z.string(),
    created_at: z.string().nullable(),
    tenants: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
            // Hak memakai module yang masih hidup. Dicabut tidak tampil.
            entitlements: z.array(
                z.object({
                    id: z.string(),
                    module_id: z.string(),
                    module_name: z.string(),
                    ends_on: z.string().nullable(),
                }),
            ),
            environments: z.array(
                z.object({
                    id: z.string(),
                    kind: environmentKindSchema,
                    name: z.string(),
                    status: environmentStatusSchema,
                    database_name: z.string().nullable(),
                    runtime_host: z.string().nullable(),
                    // Penyiapannya pernah selesai, jadi skemanya boleh diperbarui.
                    provisioned: z.boolean(),
                    expires_at: z.string().nullable(),
                    created_at: z.string().nullable(),
                    // Lingkungan yang dihapus lunak tetap tampil sampai isinya boleh dibuang.
                    purge_after: z.string().nullable(),
                    // Laporan terakhir worker host-nya; null sampai worker pertama kali melapor.
                    reported_migrations: z
                        .record(z.string(), z.string())
                        .nullable(),
                    reported_size_bytes: z.number().nullable(),
                    reported_healthy: z.boolean().nullable(),
                    reported_problem: z.string().nullable(),
                    reported_at: z.string().nullable(),
                    // Hak module tenant sudah diterapkan di database lingkungan ini.
                    entitlements_applied: z.boolean(),
                    operations: z.array(
                        z.object({
                            id: z.string(),
                            operation: operationNameSchema,
                            status: operationStatusSchema,
                            step: z.string().nullable(),
                            failure_message: z.string().nullable(),
                            requested_by: z.string().nullable(),
                            requested_at: z.string(),
                            started_at: z.string().nullable(),
                            finished_at: z.string().nullable(),
                            lease_until: z.string().nullable(),
                        }),
                    ),
                }),
            ),
        }),
    ),
});

// Satu customer dengan setiap tenant, lingkungan, dan 20 operasi terakhir tiap lingkungan. Langkah yang tercatat hanya
// langkah terakhir setiap operasi; worker tidak menyimpan riwayat langkah.
export async function findCustomer(db: Database, clientId: string) {
    const customer = await db.one(
        customerDetailSchema,
        `select c.id as client_id, c.legal_name, c.slug, ${iso('c.created_at')} as created_at,
            coalesce((select json_agg(json_build_object(
                'id', t.id, 'name', t.name, 'slug', t.slug,
                'entitlements', coalesce((select json_agg(json_build_object(
                    'id', m.id, 'module_id', m.module_id, 'module_name', cm.name,
                    'ends_on', to_char(m.ends_on, 'YYYY-MM-DD')) order by cm.name, m.module_id)
                    from tenant_module_entitlements m join catalog_modules cm on cm.id = m.module_id
                    where m.tenant_id = t.id and m.deleted_at is null), '[]'),
                'environments', coalesce((select json_agg(json_build_object(
                    'id', e.id, 'kind', e.kind, 'name', e.name, 'status', e.status,
                    'database_name', e.database_name, 'runtime_host', h.name,
                    'provisioned', e.schema_migrated_at is not null,
                    'expires_at', to_char(e.expires_at, 'YYYY-MM-DD'),
                    'created_at', ${iso('e.created_at')}, 'purge_after', ${iso('e.purge_after')},
                    'reported_migrations', e.reported_migrations, 'reported_size_bytes', e.reported_size_bytes,
                    'reported_healthy', e.reported_healthy, 'reported_problem', e.reported_problem,
                    'reported_at', ${iso('e.reported_at')},
                    'entitlements_applied', coalesce(e.applied_entitlements, '[]'::jsonb) = ${desiredEntitlements},
                    'operations', coalesce((select json_agg(json_build_object(
                        'id', o.id, 'operation', o.operation, 'status', o.status, 'step', o.step,
                        'failure_message', o.failure_message, 'requested_by', op.name,
                        'requested_at', ${iso('o.requested_at')}, 'started_at', ${iso('o.started_at')},
                        'finished_at', ${iso('o.finished_at')}, 'lease_until', ${iso('o.lease_until')})
                        order by o.requested_at desc, o.id desc)
                        from (select * from environment_operations where environment_id = e.id
                              order by requested_at desc, id desc limit 20) o
                        left join operators op on op.id = o.requested_by), '[]'))
                    order by e.created_at)
                    from environments e left join runtime_hosts h on h.id = e.runtime_host_id
                    where e.tenant_id = t.id and e.purged_at is null), '[]'))
                order by t.slug)
                from tenants t where t.client_id = c.id), '[]') as tenants
         from clients c where c.id = $1`,
        [clientId],
    );
    if (!customer)
        throw new HttpFailure(404, {
            error: 'customer_not_found',
            message: 'Customer tidak ditemukan.',
        });
    return customer;
}
