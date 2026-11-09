import { describe, expect, test } from 'bun:test';
import { parseSignature } from '../../../src/sites/signature/agent-signature.ts';
import { signedRequest, siteKeyPair } from '../../support/agent-client.ts';

const keys = siteKeyPair();
const other = siteKeyPair();
const keyId = '01JQST0000E008000000000001';
const now = Math.floor(Date.now() / 1000);

async function check(request: Request, publicKey = keys.publicKey) {
    const url = new URL(request.url);
    const parsed = parseSignature(
        {
            method: request.method,
            path: url.pathname,
            contentDigest: request.headers.get('content-digest'),
            signatureInput: request.headers.get('signature-input'),
            signature: request.headers.get('signature'),
        },
        new Uint8Array(await request.arrayBuffer()),
        now,
    );
    return (
        parsed !== null && parsed.keyId === keyId && parsed.verify(publicKey)
    );
}

const sign = (overrides: Partial<Parameters<typeof signedRequest>[0]> = {}) =>
    signedRequest({
        method: 'POST',
        path: '/api/agent/v1/report',
        body: { site_id: keyId },
        keyId,
        privateKey: keys.privateKey,
        created: now,
        ...overrides,
    });

function withHeader(request: Request, name: string, value: string) {
    const headers = new Headers(request.headers);
    headers.set(name, value);
    return new Request(request.url, {
        method: request.method,
        headers,
        body: request.method === 'GET' ? undefined : request.body,
    });
}

describe('agent signature', () => {
    test('accepts what the agent signs, including GET with an empty digest', async () => {
        expect(await check(sign())).toBe(true);
        expect(
            await check(
                sign({
                    method: 'GET',
                    path: '/api/agent/v1/releases/coreerp/1.0.0/files/manifest.json',
                    body: undefined,
                }),
            ),
        ).toBe(true);
    });

    test('rejects another key, a changed body, and a digest of other bytes', async () => {
        expect(await check(sign(), other.publicKey)).toBe(false);
        const signed = sign();
        const tampered = new Request(signed.url, {
            method: 'POST',
            headers: signed.headers,
            body: JSON.stringify({ site_id: 'someone-else' }),
        });
        expect(await check(tampered)).toBe(false);
        expect(await check(sign({ digestOf: 'other bytes' }))).toBe(false);
    });

    test('rejects a request signed for another path or method', async () => {
        const signed = sign({ path: '/api/agent/v1/key' });
        const moved = new Request('http://localhost/api/agent/v1/report', {
            method: 'POST',
            headers: signed.headers,
            body: JSON.stringify({ site_id: keyId }),
        });
        expect(await check(moved)).toBe(false);
    });

    test('rejects created outside 300 seconds', async () => {
        expect(await check(sign({ created: now - 299 }))).toBe(true);
        expect(await check(sign({ created: now - 301 }))).toBe(false);
        expect(await check(sign({ created: now + 301 }))).toBe(false);
    });

    test('rejects other parameter orders, algorithms, labels, and missing headers', async () => {
        const signed = sign();
        const input = signed.headers.get('signature-input')!;
        for (const changed of [
            input.replace(
                `;keyid="${keyId}";alg="rsa-v1_5-sha256"`,
                `;alg="rsa-v1_5-sha256";keyid="${keyId}"`,
            ),
            input.replace('rsa-v1_5-sha256', 'rsa-pss-sha512'),
            input.replace('sig1=', 'sig2='),
            input.replace('"@path" ', ''),
        ])
            expect(
                await check(withHeader(sign(), 'signature-input', changed)),
            ).toBe(false);
        expect(
            await check(withHeader(sign(), 'signature', 'sig1=:not base64:')),
        ).toBe(false);
        const bare = new Request(signed.url, {
            method: 'POST',
            body: JSON.stringify({ site_id: keyId }),
        });
        expect(await check(bare)).toBe(false);
    });
});
