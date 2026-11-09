import {
    createCipheriv,
    createDecipheriv,
    createHmac,
    randomBytes,
} from 'node:crypto';

// Enkripsi AES-256-GCM: rahasia 2FA dan setelan konsol di database, serta cookie upacara SSO. Kuncinya diturunkan dari APP_KEY per tujuan,
// jadi kunci penanda tangan sesi tidak pernah dipakai langsung untuk enkripsi, dan isi satu tujuan tidak bisa dibuka
// sebagai tujuan lain.
export class SecretBox {
    private readonly key: Buffer;

    constructor(
        appKey: Buffer,
        purpose: 'two-factor' | 'sso-ceremony' | 'console-settings',
    ) {
        this.key = createHmac('sha256', appKey)
            .update(`operator-${purpose}-encryption`)
            .digest();
    }

    seal(clear: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const sealed = Buffer.concat([
            cipher.update(clear, 'utf8'),
            cipher.final(),
        ]);
        return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString(
            'base64url',
        );
    }

    open(value: string): string {
        const bytes = Buffer.from(value, 'base64url');
        const decipher = createDecipheriv(
            'aes-256-gcm',
            this.key,
            bytes.subarray(0, 12),
        );
        decipher.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([
            decipher.update(bytes.subarray(28)),
            decipher.final(),
        ]).toString('utf8');
    }
}
