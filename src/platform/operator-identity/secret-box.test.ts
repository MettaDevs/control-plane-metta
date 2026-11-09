import { describe, expect, test } from 'bun:test';
import { SecretBox } from './secret-box.ts';

describe('secret box', () => {
    const box = new SecretBox(Buffer.alloc(32, 1), 'two-factor');

    test('opens what it sealed, with a new nonce each time', () => {
        const sealed = box.seal('JBSWY3DPEHPK3PXP');
        expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
        expect(box.seal('JBSWY3DPEHPK3PXP')).not.toBe(sealed);
        expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    });

    test('refuses a changed value and another key', () => {
        const sealed = Buffer.from(box.seal('secret'), 'base64url');
        sealed[sealed.length - 1]! ^= 1;
        expect(() => box.open(sealed.toString('base64url'))).toThrow();
        expect(() =>
            new SecretBox(Buffer.alloc(32, 2), 'two-factor').open(
                box.seal('secret'),
            ),
        ).toThrow();
    });
});
