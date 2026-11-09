import { createPublicKey } from 'node:crypto';

// Kunci publik situs: PEM SubjectPublicKeyInfo RSA paling sedikit 2048 bit, sama dengan aturan konsol CoreERP. Agen
// membuat kunci RSA 3072 bit di server klien; kunci privatnya tidak pernah keluar dari sana.
export function validSitePublicKey(value: unknown): string | null {
    if (
        typeof value !== 'string' ||
        value.length > 16_000 ||
        !value.trimStart().startsWith('-----BEGIN PUBLIC KEY-----')
    )
        return null;
    try {
        const key = createPublicKey(value);
        return key.asymmetricKeyType === 'rsa' &&
            (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048
            ? value
            : null;
    } catch {
        return null;
    }
}
