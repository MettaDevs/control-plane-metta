import type { PortalSettings } from '../../platform/config/index.ts';

export type InvitationEmail = {
    recipientEmail: string;
    recipientName: string | null;
    acceptUrl: string;
    expiresInDays: number;
    invitedBy: string;
};

// Meminta penyedia SSO mengirim email undangan; isi surat, pengirim, dan tampilannya milik penyedia
// (`POST /api/v1/notifications/send-invitation`, sama dengan CoreERP). Penyedia hanya menerima accept_url yang host-nya
// terdaftar di klien pemanggil, jadi yang dipakai klien SSO portal. Mengembalikan alasan gagal, atau null bila
// penyedia menerima. Gagal kirim bukan gagal mengundang: undangannya sudah tersimpan dan bisa dikirim ulang.
export async function sendInvitationEmail(
    portal: PortalSettings,
    email: InvitationEmail,
): Promise<string | null> {
    let response: Response;
    try {
        response = await fetch(
            `${portal.sso.issuer.replace(/\/+$/, '')}/api/v1/notifications/send-invitation`,
            {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'x-client-id': portal.sso.clientId,
                    'x-client-secret': portal.sso.clientSecret,
                },
                body: JSON.stringify({
                    recipient_email: email.recipientEmail,
                    recipient_name: email.recipientName,
                    app_name: 'Portal klien',
                    role_name: 'Admin klinik',
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
        return 'Penyedia SSO menolak kredensial PORTAL_SSO_CLIENT_ID dan PORTAL_SSO_CLIENT_SECRET.';
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
