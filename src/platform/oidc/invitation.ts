import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SsoSettings } from '../config/index.ts';

// Undangan lewat penyedia SSO, dipakai undangan portal klien dan undangan operator konsol. Tautan undangan membawa
// token acak; yang tersimpan hanya hash SHA-256-nya.
export const invitationDays = 7;

export const invitationInputSchema = z.strictObject({
    recipient_email: z
        .email('Isi alamat email yang benar.')
        .max(255, 'Email paling panjang 255 karakter.')
        .toLowerCase(),
    recipient_name: z
        .string()
        .trim()
        .max(255, 'Nama paling panjang 255 karakter.')
        .nullable()
        .transform((value) => value || null),
});
export type InvitationInput = z.infer<typeof invitationInputSchema>;

export function invitationInputErrors(
    error: z.ZodError,
): Record<string, string[]> {
    return Object.fromEntries(
        error.issues.map((issue) => [
            issue.path.join('.') || '_form',
            [issue.message],
        ]),
    );
}

export function hashInvitationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function newInvitationToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashInvitationToken(token) };
}

export type InvitationEmail = {
    recipientEmail: string;
    recipientName: string | null;
    acceptUrl: string;
    expiresInDays: number;
    invitedBy: string;
    appName: string;
    roleName: string;
};

// Meminta penyedia SSO mengirim email undangan; isi surat, pengirim, dan tampilannya milik penyedia
// (`POST /api/v1/notifications/send-invitation`, sama dengan CoreERP). Penyedia hanya menerima accept_url yang host-nya
// terdaftar di klien pemanggil, jadi undangan portal memakai klien SSO portal dan undangan operator memakai klien SSO
// konsol. envPrefix menyebut nama env kredensial itu di pesan gagal. Mengembalikan alasan gagal, atau null bila
// penyedia menerima. Gagal kirim bukan gagal mengundang: undangannya sudah tersimpan dan bisa dikirim ulang.
export async function sendInvitationEmail(
    sso: Pick<SsoSettings, 'issuer' | 'clientId' | 'clientSecret'>,
    envPrefix: 'PORTAL_SSO' | 'CONSOLE_SSO',
    email: InvitationEmail,
): Promise<string | null> {
    let response: Response;
    try {
        response = await fetch(
            `${sso.issuer.replace(/\/+$/, '')}/api/v1/notifications/send-invitation`,
            {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'x-client-id': sso.clientId,
                    'x-client-secret': sso.clientSecret,
                },
                body: JSON.stringify({
                    recipient_email: email.recipientEmail,
                    recipient_name: email.recipientName,
                    app_name: email.appName,
                    role_name: email.roleName,
                    accept_url: email.acceptUrl,
                    invited_by: email.invitedBy,
                    expires_in_days: Math.max(
                        1,
                        Math.min(30, email.expiresInDays),
                    ),
                }),
                signal: AbortSignal.timeout(10_000),
            },
        );
    } catch {
        return 'Penyedia SSO tidak dapat dihubungi.';
    }
    if (response.ok) return null;
    if (response.status === 401 || response.status === 403)
        return `Penyedia SSO menolak kredensial ${envPrefix}_CLIENT_ID dan ${envPrefix}_CLIENT_SECRET.`;
    if (response.status === 429)
        return 'Penyedia SSO sedang membatasi jumlah permintaan. Coba lagi sebentar lagi.';
    const body: unknown = await response.json().catch(() => null);
    const message =
        typeof body === 'object' &&
        body !== null &&
        'message' in body &&
        typeof body.message === 'string'
            ? body.message
            : null;
    return message ?? `Penyedia SSO menjawab HTTP ${String(response.status)}.`;
}
