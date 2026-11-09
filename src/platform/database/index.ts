import postgres from 'postgres';
import { z } from 'zod';
import type { Config } from '../config/index.ts';

export type Bind = string | number | boolean | null;

export function createPool(config: Config) {
    return postgres({
        host: config.DB_HOST,
        port: config.DB_PORT,
        database: config.DB_DATABASE,
        username: config.DB_USERNAME,
        password: config.DB_PASSWORD,
        max: config.DB_POOL_SIZE,
        idle_timeout: 30,
        connect_timeout: 10,
        onnotice: () => {},
    });
}

export type Pool = ReturnType<typeof createPool>;

// Satu request memegang satu koneksi sampai selesai, supaya transaksinya berjalan di koneksi yang sama. Koneksi baru
// diambil pada query pertama, jadi request yang tidak menyentuh database, misalnya /up, tidak memakai jatah pool.
export class Database {
    private connection: Promise<postgres.ReservedSql> | undefined;
    private depth = 0;
    private savepoint = 0;

    constructor(private readonly pool: Pool) {}

    private reserved(): Promise<postgres.ReservedSql> {
        this.connection ??= this.pool.reserve();
        return this.connection;
    }

    private async run<T>(
        query: string,
        parameters: Bind[],
        read: (rows: postgres.RowList<postgres.Row[]>) => T,
    ): Promise<T> {
        const sql = await this.reserved();
        // unsafe() tidak memakai prepared statement secara bawaan, sehingga setiap query di-parse dan di-plan ulang.
        return read(await sql.unsafe(query, parameters, { prepare: true }));
    }

    async rows<S extends z.ZodType>(
        schema: S,
        query: string,
        parameters: Bind[] = [],
    ): Promise<z.output<S>[]> {
        return this.run(query, parameters, (rows) =>
            z.array(schema).parse(rows),
        );
    }

    async one<S extends z.ZodType>(
        schema: S,
        query: string,
        parameters: Bind[] = [],
    ): Promise<z.output<S> | undefined> {
        return (await this.rows(schema, query, parameters))[0];
    }

    async execute(query: string, parameters: Bind[] = []): Promise<number> {
        return this.run(query, parameters, (rows) => rows.count);
    }

    async transaction<T>(callback: () => Promise<T>): Promise<T> {
        const nested = this.depth > 0;
        const name = `savepoint_${++this.savepoint}`;
        await this.execute(nested ? `savepoint ${name}` : 'begin');
        this.depth++;
        try {
            const value = await callback();
            await this.execute(nested ? `release savepoint ${name}` : 'commit');
            return value;
        } catch (error) {
            await this.execute(
                nested ? `rollback to savepoint ${name}` : 'rollback',
            );
            throw error;
        } finally {
            this.depth--;
        }
    }

    async release(): Promise<void> {
        const connection = this.connection;
        this.connection = undefined;
        if (connection) (await connection).release();
    }
}

export function sqlErrorCode(error: unknown): string | undefined {
    return error instanceof postgres.PostgresError ? error.code : undefined;
}
