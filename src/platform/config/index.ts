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
    // Hasil build peramban untuk layar konsol (`bun run build`). Hanya proses konsol yang membacanya.
    CLIENT_DIR: z.string().min(1).default('dist/client'),
    // Hasil build peramban untuk layar portal klien. Hanya proses portal yang membacanya.
    PORTAL_CLIENT_DIR: z.string().min(1).default('dist/portal-client'),
    // SSO operator. Keempatnya diisi bersama, atau dikosongkan bersama untuk mematikan SSO.
    CONSOLE_SSO_ISSUER: z.url().optional(),
    CONSOLE_SSO_CLIENT_ID: z.string().min(1).optional(),
    CONSOLE_SSO_CLIENT_SECRET: z.string().min(1).optional(),
    CONSOLE_SSO_REDIRECT_URI: z.url().optional(),
    // Alamat dasar aplikasi klinik (operations-metta), misalnya https://operations.example.com. Konsol dan portal
    // menurunkan alamat setiap lingkungan darinya; kosong berarti alamat tidak ditampilkan.
    OPERATIONS_URL: z.url().optional(),
    // Portal klien: alamatnya, dan klien SSO miliknya (terpisah dari klien konsol, karena penyedia mencocokkan alamat
    // balik persis). Konsol memakainya juga untuk meminta penyedia mengirim email undangan, karena penyedia hanya
    // menerima tautan undangan yang host-nya terdaftar di klien itu. Keempatnya diisi bersama, atau dikosongkan bersama.
    PORTAL_URL: z.url().optional(),
    PORTAL_SSO_ISSUER: z.url().optional(),
    PORTAL_SSO_CLIENT_ID: z.string().min(1).optional(),
    PORTAL_SSO_CLIENT_SECRET: z.string().min(1).optional(),
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
    // Registry Harbor tempat agen menarik image rilis: host yang diberikan ke agen, alamat API Harbor yang dipanggil
    // control plane, dan umur robot pull-only per operasi sebagai penjaga terakhir bila penghapusannya tidak pernah
    // berhasil. Robot sistemnya disimpan terenkripsi lewat `cli.ts set-registry-robot`, bukan di env.
    CONSOLE_REGISTRY_HOST: z.string().min(1).optional(),
    CONSOLE_REGISTRY_API_URL: z.url().optional(),
    CONSOLE_REGISTRY_ROBOT_DAYS: z.coerce
        .number()
        .int()
        .min(1)
        .max(30)
        .default(1),
    // Berapa hari isi lingkungan yang dihapus lunak (misalnya demo yang kedaluwarsa) masih disimpan sebelum boleh
    // dibuang permanen. Minimal sehari, supaya hapus lunak dan buang permanen tidak pernah jatuh di hari yang sama.
    ENVIRONMENT_PURGE_GRACE_DAYS: z.coerce
        .number()
        .int()
        .min(1)
        .max(3650)
        .default(30),
});

export type SsoSettings = {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
};

export type PortalSettings = {
    // Tanpa garis miring di akhir, misalnya https://portal.example.com.
    url: string;
    sso: SsoSettings;
};

export type Config = z.output<typeof environmentSchema> & {
    key: Buffer;
    sso: SsoSettings | null;
    portal: PortalSettings | null;
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
    const portal = [
        values.PORTAL_URL,
        values.PORTAL_SSO_ISSUER,
        values.PORTAL_SSO_CLIENT_ID,
        values.PORTAL_SSO_CLIENT_SECRET,
    ];
    if (portal.some(Boolean) && !portal.every(Boolean))
        throw new Error(
            'Set all of PORTAL_URL, PORTAL_SSO_ISSUER, PORTAL_SSO_CLIENT_ID, and PORTAL_SSO_CLIENT_SECRET, or none.',
        );
    const portalUrl = values.PORTAL_URL?.replace(/\/+$/, '');
    return {
        ...values,
        key,
        portal: portalUrl
            ? {
                  url: portalUrl,
                  sso: {
                      issuer: values.PORTAL_SSO_ISSUER!,
                      clientId: values.PORTAL_SSO_CLIENT_ID!,
                      clientSecret: values.PORTAL_SSO_CLIENT_SECRET!,
                      redirectUri: `${portalUrl}/sso/callback`,
                  },
              }
            : null,
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
