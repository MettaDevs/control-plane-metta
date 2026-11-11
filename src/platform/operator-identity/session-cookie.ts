import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Sesi konsol tidak punya tabel. Cookie memuat id operator dan waktu login, ditandatangani HMAC-SHA256 dengan APP_KEY,
// jadi request yang hanya membaca tidak menulis apa pun ke database. Pencabutan lewat operators.sessions_valid_after.
const payloadSchema = z.object({
    operatorId: z.uuid(),
    // Milidetik, supaya login sesaat sesudah logout tidak jatuh di detik yang sama dengan pencabutannya.
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
});

export type SessionPayload = z.infer<typeof payloadSchema>;

// Cookie sesi dan cookie tunggu 2FA ditandatangani dengan tujuan berbeda, supaya cookie tunggu 2FA, yang terbit sesudah
// password benar tetapi sebelum kode 2FA, tidak pernah diterima sebagai sesi.
export type CookiePurpose = 'session' | 'two-factor';

function signature(key: Buffer, purpose: CookiePurpose, body: string): Buffer {
    return createHmac('sha256', key)
        .update(`operator-${purpose}|${body}`)
        .digest();
}

export function signSession(
    key: Buffer,
    payload: SessionPayload,
    purpose: CookiePurpose = 'session',
): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${signature(key, purpose, body).toString('base64url')}`;
}

export function readSession(
    key: Buffer,
    value: string,
    now: number,
    purpose: CookiePurpose = 'session',
): SessionPayload | null {
    const [body, mac, ...rest] = value.split('.');
    if (body === undefined || mac === undefined || rest.length) return null;
    const expected = signature(key, purpose, body);
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return null;
    try {
        const parsed = payloadSchema.safeParse(
            JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
        );
        if (!parsed.success || parsed.data.expiresAt <= now) return null;
        return parsed.data;
    } catch {
        return null;
    }
}
