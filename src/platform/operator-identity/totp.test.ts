import { describe, expect, test } from 'bun:test';
import { codeAt, matchingStep, newSecret, otpauthUri, stepAt } from './totp.ts';

// Vektor uji RFC 6238 lampiran B untuk SHA1, secret ASCII "12345678901234567890". RFC memakai delapan digit; enam
// digit terakhirnya adalah kode enam digit.
const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
    test.each([
        [59, '287082'],
        [1111111109, '081804'],
        [1111111111, '050471'],
        [1234567890, '005924'],
        [2000000000, '279037'],
    ])('matches RFC 6238 at %i seconds', (seconds, code) => {
        expect(codeAt(rfcSecret, stepAt(seconds * 1000))).toBe(code);
    });

    test('accepts one step of clock drift either way, nothing more', () => {
        const now = 1111111109 * 1000;
        const step = stepAt(now);
        expect(matchingStep(rfcSecret, codeAt(rfcSecret, step - 1), now)).toBe(
            step - 1,
        );
        expect(matchingStep(rfcSecret, codeAt(rfcSecret, step + 1), now)).toBe(
            step + 1,
        );
        expect(
            matchingStep(rfcSecret, codeAt(rfcSecret, step + 2), now),
        ).toBeNull();
        expect(matchingStep(rfcSecret, '12345', now)).toBeNull();
        expect(matchingStep(rfcSecret, 'abcdef', now)).toBeNull();
    });

    test('makes 160-bit base32 secrets and authenticator URIs', () => {
        const secret = newSecret();
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(newSecret()).not.toBe(secret);
        expect(otpauthUri(secret, 'admin.example.com', 'a@example.com')).toBe(
            `otpauth://totp/admin.example.com%3Aa%40example.com?secret=${secret}&issuer=admin.example.com&algorithm=SHA1&digits=6&period=30`,
        );
    });
});
