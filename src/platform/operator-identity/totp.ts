import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP RFC 6238: HMAC-SHA1, enam digit, langkah 30 detik. Sama dengan bawaan Fortify di CoreERP dan aplikasi
// authenticator umumnya.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const stepSeconds = 30;
const digits = 6;

export function newSecret(): string {
    const bytes = randomBytes(20);
    let bits = '';
    for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
    let secret = '';
    for (let index = 0; index < bits.length; index += 5)
        secret += alphabet[parseInt(bits.slice(index, index + 5), 2)];
    return secret;
}

function decode(secret: string): Buffer {
    let bits = '';
    for (const character of secret.toUpperCase().replace(/=+$/, '')) {
        const value = alphabet.indexOf(character);
        if (value < 0) throw new Error('Invalid base32 secret.');
        bits += value.toString(2).padStart(5, '0');
    }
    const bytes: number[] = [];
    for (let index = 0; index + 8 <= bits.length; index += 8)
        bytes.push(parseInt(bits.slice(index, index + 8), 2));
    return Buffer.from(bytes);
}

export function codeAt(secret: string, step: number): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const mac = createHmac('sha1', decode(secret)).update(counter).digest();
    const offset = mac[mac.length - 1]! & 0x0f;
    const value = mac.readUInt32BE(offset) & 0x7fffffff;
    return String(value % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (now: number) => Math.floor(now / 1000 / stepSeconds);

// Langkah yang cocok dengan kode, satu langkah ke belakang dan ke depan untuk selisih jam ponsel, atau null.
export function matchingStep(
    secret: string,
    code: string,
    now: number,
): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const current = stepAt(now);
    for (const step of [current - 1, current, current + 1]) {
        const expected = Buffer.from(codeAt(secret, step));
        if (timingSafeEqual(expected, Buffer.from(code))) return step;
    }
    return null;
}

export function otpauthUri(
    secret: string,
    issuer: string,
    account: string,
): string {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const query = new URLSearchParams({
        secret,
        issuer,
        algorithm: 'SHA1',
        digits: String(digits),
        period: String(stepSeconds),
    });
    return `otpauth://totp/${label}?${query}`;
}
