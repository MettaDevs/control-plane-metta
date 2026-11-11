import { expect, test } from 'bun:test';
import { readCookie } from '../../../src/platform/http/index.ts';

test('finds a cookie by exact name', () => {
    const request = new Request('http://localhost/', {
        headers: { cookie: 'other_session=a; session=b=c; x=y' },
    });
    expect(readCookie(request, 'session')).toBe('b=c');
    expect(readCookie(request, 'missing')).toBeNull();
});
