import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';

// Repo ini hanya punya satu pemilik migration, tidak seperti operations-metta yang mencatat Core dan setiap module.
type Migration = { name: string; sql: string; checksum: string };

const directory = resolve(import.meta.dir, '..', 'database', 'migrations');

const environment = z
    .object({
        DB_HOST: z.string().min(1),
        DB_PORT: z.coerce.number().int().positive(),
        DB_DATABASE: z.string().min(1),
        DB_USERNAME: z.string().min(1),
        DB_PASSWORD: z.string().min(1),
    })
    .parse(process.env);

const migrations: Migration[] = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
        const bytes = readFileSync(join(directory, name));
        return {
            name,
            sql: bytes.toString('utf8'),
            checksum: createHash('sha256').update(bytes).digest('hex'),
        };
    });

const sql = postgres({
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    database: environment.DB_DATABASE,
    username: environment.DB_USERNAME,
    password: environment.DB_PASSWORD,
    max: 1,
    onnotice: (notice) => console.log(notice.message),
});

async function migrate(): Promise<void> {
    // Dua proses migrate yang berjalan bersamaan saling menunggu di kunci ini, bukan saling menabrak.
    await sql`select pg_advisory_lock(hashtext('schema_migrations'))`;
    // Selalu bersama schema-nya, karena berkas migration boleh mengosongkan search_path (0001 melakukannya).
    await sql`
        create table if not exists public.schema_migrations (
            name text primary key,
            checksum text not null,
            applied_at timestamptz not null default now()
        )`;
    const applied = new Map(
        (
            await sql<
                { name: string; checksum: string }[]
            >`select name, checksum from public.schema_migrations`
        ).map((row) => [row.name, row.checksum]),
    );

    const files = new Map(migrations.map((file) => [file.name, file]));
    const problems = [...applied].flatMap(([name, checksum]) => {
        const file = files.get(name);
        if (!file) return [`${name} is recorded as applied but has no file.`];
        if (file.checksum !== checksum)
            return [
                `${name} changed after it was applied: recorded ${checksum}, file ${file.checksum}.`,
            ];
        return [];
    });
    if (problems.length) throw new Error(problems.join('\n'));

    const pending = migrations.filter(
        (migration) => !applied.has(migration.name),
    );
    for (const migration of pending) {
        const started = performance.now();
        await sql.begin(async (transaction) => {
            // Setelan sesi dari berkas sebelumnya (misalnya search_path kosong dari pg_dump) tidak boleh terbawa.
            await transaction.unsafe('reset all');
            await transaction.unsafe(migration.sql);
            await transaction`insert into public.schema_migrations (name, checksum) values (${migration.name}, ${migration.checksum})`;
        });
        const seconds = (performance.now() - started) / 1000;
        console.log(`applied ${migration.name} in ${seconds.toFixed(1)} s`);
    }
    if (!pending.length) console.log('database is up to date');
}

try {
    await migrate();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await sql.end();
}
