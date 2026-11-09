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
});

export type Config = z.output<typeof environmentSchema>;

export function loadConfig(
    environment: Record<string, string | undefined> = process.env,
): Config {
    return environmentSchema.parse(environment);
}
