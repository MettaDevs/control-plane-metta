import { z } from 'zod';
import { recordAudit } from '../audit/index.ts';
import type { Database } from '../database/index.ts';

export const operatorSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
});
export type Operator = z.infer<typeof operatorSchema>;

const credentialSchema = operatorSchema.extend({ password: z.string() });

export const newOperatorSchema = z.object({
    name: z.string().trim().min(1).max(255),
    email: z.email().max(255),
    password: z.string().min(12).max(1024),
});

// Hash pembanding untuk email yang tidak terdaftar, supaya waktu jawabnya sama dengan password yang salah.
const absentHash = await Bun.password.hash(crypto.randomUUID());

export async function createOperator(
    db: Database,
    input: z.input<typeof newOperatorSchema>,
    actor: { operatorId: string | null; ipAddress: string | null },
): Promise<Operator> {
    const { name, email, password } = newOperatorSchema.parse(input);
    const operator = { id: Bun.randomUUIDv7(), name, email };
    const hash = await Bun.password.hash(password);
    await db.transaction(async () => {
        await db.execute(
            `insert into operators (id, name, email, password, created_at, updated_at)
             values ($1, $2, $3, $4, now() at time zone 'utc', now() at time zone 'utc')`,
            [operator.id, name, email, hash],
        );
        await recordAudit(db, {
            ...actor,
            action: 'operator.created',
            subjectType: 'operator',
            subjectId: operator.id,
            detail: { email },
        });
    });
    return operator;
}

export async function authenticate(
    db: Database,
    email: string,
    password: string,
): Promise<Operator | null> {
    const row = await db.one(
        credentialSchema,
        'select id, name, email, password from operators where lower(email) = lower($1) and deleted_at is null',
        [email],
    );
    // Bun.password.verify juga membaca hash bcrypt, bentuk password dari data CoreERP yang kelak dipindah ke sini.
    const valid = await Bun.password.verify(
        password,
        row?.password ?? absentHash,
    );
    if (!row || !valid) return null;
    const { password: _, ...operator } = row;
    return operator;
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
