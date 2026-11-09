import { createHash, createVerify } from 'node:crypto';

// Bagian kecil HTTP Message Signatures (RFC 9421) yang dipakai agen, persis seperti contracts/agent/openapi.yaml:
// label sig1, komponen "@method" "@path" "content-digest" dalam urutan itu, parameter created, keyid, dan alg dalam
// urutan itu, alg rsa-v1_5-sha256, dan Content-Digest sha-256. Bentuk lain ditolak, bukan ditafsirkan.
const signatureInput =
    /^sig1=(\("@method" "@path" "content-digest"\);created=(\d{1,12});keyid="([A-Za-z0-9._-]{1,100})";alg="rsa-v1_5-sha256")$/;
const signatureValue = /^sig1=:([A-Za-z0-9+/]+={0,2}):$/;
export const maxClockSkewSeconds = 300;

export type SignedHeaders = {
    method: string;
    path: string;
    contentDigest: string | null;
    signatureInput: string | null;
    signature: string | null;
};

export function contentDigest(body: Uint8Array): string {
    return `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
}

// keyid dari header yang bentuknya sah dan waktunya masih dalam batas, beserta pemeriksa tanda tangannya. null bila
// ada yang tidak sah; alasannya sengaja tidak dibedakan, karena jawabannya selalu signature_invalid.
export function parseSignature(
    headers: SignedHeaders,
    body: Uint8Array,
    nowSeconds: number,
): { keyId: string; verify: (publicKeyPem: string) => boolean } | null {
    const input = signatureInput.exec(headers.signatureInput?.trim() ?? '');
    const value = signatureValue.exec(headers.signature?.trim() ?? '');
    const [, parameters, created, keyId] = input ?? [];
    const encoded = value?.[1];
    if (!parameters || !created || !keyId || !encoded) return null;
    if (Math.abs(nowSeconds - Number(created)) > maxClockSkewSeconds)
        return null;
    const digest = contentDigest(body);
    if (headers.contentDigest?.trim() !== digest) return null;
    const base = [
        `"@method": ${headers.method.toUpperCase()}`,
        `"@path": ${headers.path}`,
        `"content-digest": ${digest}`,
        `"@signature-params": ${parameters}`,
    ].join('\n');
    const signature = Buffer.from(encoded, 'base64');
    return {
        keyId,
        verify: (publicKeyPem) => {
            try {
                return createVerify('sha256')
                    .update(base)
                    .verify(publicKeyPem, signature);
            } catch {
                return false;
            }
        },
    };
}
