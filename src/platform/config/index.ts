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
    // SSO operator. Keempatnya diisi bersama, atau dikosongkan bersama untuk mematikan SSO.
    CONSOLE_SSO_ISSUER: z.url().optional(),
    CONSOLE_SSO_CLIENT_ID: z.string().min(1).optional(),
    CONSOLE_SSO_CLIENT_SECRET: z.string().min(1).optional(),
    CONSOLE_SSO_REDIRECT_URI: z.url().optional(),
    // Pelaporan kesalahan ke Sentry. Kosong berarti mati.
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    SENTRY_RELEASE: z.string().min(1).optional(),
    // Pendaftaran rilis dari alur rilis: token bearer, kunci publik penanda tangan SHA256SUMS (PEM), dan project
    // registry tempat setiap image rilis tinggal. Nama env sama dengan konsol CoreERP. Tanpa token, setiap
    // pendaftaran ditolak.
    CONSOLE_RELEASE_TOKEN: z.string().min(1).optional(),
    CONSOLE_RELEASE_PUBLIC_KEY_PATH: z.string().min(1).optional(),
    CONSOLE_REGISTRY_PROJECT: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{0,62}$/)
        .optional(),
});

export type SsoSettings = {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
};

export type Config = z.output<typeof environmentSchema> & {
    key: Buffer;
    sso: SsoSettings | null;
};

export function loadConfig(
    environment: Record<string, string | undefined> = process.env,
): Config {
    const values = environmentSchema.parse(environment);
    const key = values.APP_KEY.startsWith('base64:')
        ? Buffer.from(values.APP_KEY.slice(7), 'base64')
        : Buffer.from(values.APP_KEY);
    if (key.length !== 32)
        throw new Error('APP_KEY must contain a 32-byte key.');
    const sso = [
        values.CONSOLE_SSO_ISSUER,
        values.CONSOLE_SSO_CLIENT_ID,
        values.CONSOLE_SSO_CLIENT_SECRET,
        values.CONSOLE_SSO_REDIRECT_URI,
    ];
    if (sso.some(Boolean) && !sso.every(Boolean))
        throw new Error(
            'Set all of CONSOLE_SSO_ISSUER, CONSOLE_SSO_CLIENT_ID, CONSOLE_SSO_CLIENT_SECRET, and CONSOLE_SSO_REDIRECT_URI, or none.',
        );
    return {
        ...values,
        key,
        sso: values.CONSOLE_SSO_ISSUER
            ? {
                  issuer: values.CONSOLE_SSO_ISSUER,
                  clientId: values.CONSOLE_SSO_CLIENT_ID!,
                  clientSecret: values.CONSOLE_SSO_CLIENT_SECRET!,
                  redirectUri: values.CONSOLE_SSO_REDIRECT_URI!,
              }
            : null,
    };
}
