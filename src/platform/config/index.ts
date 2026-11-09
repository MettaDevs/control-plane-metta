import { z } from 'zod';

// Setiap proses membaca setelan yang sama; konsol dan agen berbeda host dan port lewat env container masing-masing.
const environmentSchema = z.object({
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().positive(),
    DB_DATABASE: z.string().min(1),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(4),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(8000),
    APP_KEY: z.string().min(1),
    SESSION_COOKIE: z.string().default('control_plane_session'),
    SESSION_LIFETIME: z.coerce.number().int().positive().default(120),
    SESSION_SECURE_COOKIE: z.enum(['true', 'false']).default('true'),
});

export type Config = z.output<typeof environmentSchema> & { key: Buffer };

export function loadConfig(
    environment: Record<string, string | undefined> = process.env,
): Config {
    const values = environmentSchema.parse(environment);
    const key = values.APP_KEY.startsWith('base64:')
        ? Buffer.from(values.APP_KEY.slice(7), 'base64')
        : Buffer.from(values.APP_KEY);
    if (key.length !== 32)
        throw new Error('APP_KEY must contain a 32-byte key.');
    return { ...values, key };
}
