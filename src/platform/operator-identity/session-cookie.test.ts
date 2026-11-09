import { describe, expect, test } from 'bun:test';
import { readCookie, readSession, signSession } from './session-cookie.ts';

const key = Buffer.alloc(32, 1);
const payload = {
    operatorId: '0195f3a0-0000-7000-8000-000000000001',
    issuedAt: 1_000,
    expiresAt: 2_000,
};

describe('session cookie', () => {
    test('reads back what it signed until it expires', () => {
        const value = signSession(key, payload);
        expect(readSession(key, value, 1_999)).toEqual(payload);
        expect(readSession(key, value, 2_000)).toBeNull();
    });

    test('rejects a changed payload, another key, and garbage', () => {
        const value = signSession(key, payload);
        const [, mac] = value.split('.');
        const forged = `${Buffer.from(JSON.stringify({ ...payload, expiresAt: 9_999 })).toString('base64url')}.${mac}`;
        expect(readSession(key, forged, 1_500)).toBeNull();
        expect(readSession(Buffer.alloc(32, 2), value, 1_500)).toBeNull();
        expect(readSession(key, 'not-a-cookie', 1_500)).toBeNull();
        expect(readSession(key, `${value}.extra`, 1_500)).toBeNull();
    });

    test('finds a cookie by exact name', () => {
        const request = new Request('http://localhost/', {
            headers: { cookie: 'other_session=a; session=b=c; x=y' },
        });
        expect(readCookie(request, 'session')).toBe('b=c');
        expect(readCookie(request, 'missing')).toBeNull();
    });
});
