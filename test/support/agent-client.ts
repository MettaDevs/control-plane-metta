import { createHash, createSign, generateKeyPairSync } from 'node:crypto';

// Menandatangani request seperti deploy/agent/coreerp-agent di CoreERP: openssl dgst -sha256 -sign atas signature base
// RFC 9421 dengan komponen "@method" "@path" "content-digest" dan parameter created, keyid, alg.
export function siteKeyPair() {
    return generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
}

export function signedRequest(input: {
    method: string;
    path: string;
    body?: unknown;
    keyId: string;
    privateKey: string;
    created?: number;
    digestOf?: string;
}): Request {
    const body =
        input.body === undefined
            ? ''
            : typeof input.body === 'string'
              ? input.body
              : JSON.stringify(input.body);
    const digest = `sha-256=:${createHash('sha256')
        .update(input.digestOf ?? body)
        .digest('base64')}:`;
    const created = input.created ?? Math.floor(Date.now() / 1000);
    const parameters = `("@method" "@path" "content-digest");created=${created};keyid="${input.keyId}";alg="rsa-v1_5-sha256"`;
    const base = [
        `"@method": ${input.method}`,
        `"@path": ${input.path}`,
        `"content-digest": ${digest}`,
        `"@signature-params": ${parameters}`,
    ].join('\n');
    const signature = createSign('sha256')
        .update(base)
        .sign(input.privateKey, 'base64');
    return new Request(`http://localhost${input.path}`, {
        method: input.method,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'content-digest': digest,
            'signature-input': `sig1=${parameters}`,
            signature: `sig1=:${signature}:`,
            'user-agent': 'coreerp-agent/0.1.0',
        },
        body: input.method === 'GET' ? undefined : body,
    });
}
