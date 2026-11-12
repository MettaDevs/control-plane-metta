import { z } from 'zod';
import { recordAudit } from '../audit/index.ts';
import type { Database } from '../database/index.ts';

export const operatorSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
});
export type Operator = z.infer<typeof operatorSchema>;

// Operator dari undangan hanya masuk lewat SSO dan tidak punya password.
const credentialSchema = operatorSchema.extend({
    password: z.string().nullable(),
    two_factor: z.boolean(),
});

export const newOperatorSchema = z.object({
    name: z.string().trim().min(1).max(255),
    email: z.email().max(255),
    // Tanpa batas panjang minimum: password operator hanya jembatan sampai login konsol sepenuhnya lewat SSO
    // (keputusan pemilik produk, 11 November 2026).
    password: z.string().min(1).max(1024),
});

// Hash pembanding untuk email yang tidak terdaftar, supaya waktu jawabnya sama dengan password yang salah.
const absentHash = await Bun.password.hash(crypto.randomUUID());

export async function createOperator(
    db: Database,
    input: z.input<typeof newOperatorSchema>,
    actor: { operatorId: string | null; ipAddress: string | null },
): Promise<Operator> {
    const { name, email, password } = newOperatorSchema.parse(input);
    const hash = await Bun.password.hash(password);
    return db.transaction(() =>
        insertOperator(db, { name, email, password: hash }, actor),
    );
}

// Baris operator beserta jejak auditnya, di transaksi pemanggil. password null untuk operator yang hanya masuk lewat
// SSO.
export async function insertOperator(
    db: Database,
    input: { name: string; email: string; password: string | null },
    actor: { operatorId: string | null; ipAddress: string | null },
    detail: Record<string, unknown> = {},
): Promise<Operator> {
    const operator = {
        id: Bun.randomUUIDv7(),
        name: input.name,
        email: input.email,
    };
    await db.execute(
        `insert into operators (id, name, email, password, created_at, updated_at)
         values ($1, $2, $3, $4, now() at time zone 'utc', now() at time zone 'utc')`,
        [operator.id, input.name, input.email, input.password],
    );
    await recordAudit(db, {
        ...actor,
        action: 'operator.created',
        subjectType: 'operator',
        subjectId: operator.id,
        detail: { email: input.email, ...detail },
    });
    return operator;
}

const credentialColumns =
    'id, name, email, password, two_factor_confirmed_at is not null as two_factor';

async function checkPassword(
    row: z.infer<typeof credentialSchema> | undefined,
    password: string,
): Promise<{ operator: Operator; twoFactor: boolean } | null> {
    // Bun.password.verify juga membaca hash bcrypt, bentuk password dari data CoreERP yang kelak dipindah ke sini.
    // Operator tanpa password diperiksa terhadap hash pembanding, jadi jawabannya sama dengan password yang salah.
    const valid = await Bun.password.verify(
        password,
        row?.password ?? absentHash,
    );
    if (!row || row.password === null || !valid) return null;
    const { password: _, two_factor, ...operator } = row;
    return { operator, twoFactor: two_factor };
}

export async function authenticate(
    db: Database,
    email: string,
    password: string,
): Promise<{ operator: Operator; twoFactor: boolean } | null> {
    const row = await db.one(
        credentialSchema,
        `select ${credentialColumns} from operators where lower(email) = lower($1) and deleted_at is null`,
        [email],
    );
    return checkPassword(row, password);
}

// Konfirmasi password untuk tindakan yang mengubah keamanan akun, misalnya menyalakan atau mematikan 2FA.
export async function confirmPassword(
    db: Database,
    operatorId: string,
    password: string,
): Promise<boolean> {
    const row = await db.one(
        credentialSchema,
        `select ${credentialColumns} from operators where id = $1 and deleted_at is null`,
        [operatorId],
    );
    return (await checkPassword(row, password)) !== null;
}

// Operator dari undangan tidak punya password, jadi tindakan yang meminta password diketik ulang tidak bisa ia
// jalankan, dan tautan SSO-nya tidak boleh dilepas karena itu satu-satunya jalan masuknya.
export async function hasPassword(
    db: Database,
    operatorId: string,
): Promise<boolean> {
    const row = await db.one(
        z.object({ present: z.boolean() }),
        'select password is not null as present from operators where id = $1',
        [operatorId],
    );
    return row?.present ?? false;
}

export async function twoFactorEnabled(
    db: Database,
    operatorId: string,
): Promise<boolean> {
    const row = await db.one(
        z.object({ enabled: z.boolean() }),
        'select two_factor_confirmed_at is not null as enabled from operators where id = $1',
        [operatorId],
    );
    return row?.enabled ?? false;
}

// Operator aktif yang sesinya dibuat sesudah pencabutan terakhir.
export async function findSessionOperator(
    db: Database,
    operatorId: string,
    issuedAt: number,
): Promise<Operator | null> {
    return (
        (await db.one(
            operatorSchema,
            `select id, name, email from operators
             where id = $1 and deleted_at is null
               and (sessions_valid_after is null or sessions_valid_after < to_timestamp($2::double precision / 1000))`,
            [operatorId, issuedAt],
        )) ?? null
    );
}

// Waktunya dari jam aplikasi, sama dengan issuedAt di cookie, supaya selisih jam aplikasi dan database tidak
// menghidupkan sesi lama atau menolak login berikutnya.
export async function revokeSessions(
    db: Database,
    operatorId: string,
    now: number,
): Promise<void> {
    await db.execute(
        'update operators set sessions_valid_after = to_timestamp($2::double precision / 1000) where id = $1',
        [operatorId, now],
    );
}
