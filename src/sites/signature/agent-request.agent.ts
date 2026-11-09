import { z } from 'zod';
import { base, type Context, HttpFailure } from '../../platform/http/index.ts';
import { RateLimiter } from '../../platform/rate-limit/index.ts';
import { fromAgentId } from '../agent-id.ts';
import { parseSignature } from './agent-signature.ts';

// Setiap jawaban galat API agen berbentuk {"error": "<kode>"}, sesuai skema Error di kontrak.
export const agentError = (status: number, error: string): HttpFailure =>
    new HttpFailure(status, { error });

// Isi request yang sudah dibaca untuk digest dipakai juga sebagai JSON-nya, jadi yang ditandatangani agen persis yang
// diperiksa. Bukan JSON berarti undefined.
export function parseJson(body: Uint8Array): unknown {
    try {
        return JSON.parse(new TextDecoder().decode(body));
    } catch {
        return undefined;
    }
}

async function throttle(
    context: Context,
    key: string,
    maxAttempts: number,
): Promise<void> {
    const limiter = new RateLimiter(context.db, {
        maxAttempts,
        decaySeconds: 60,
    });
    const retryAfter = await limiter.retryAfter(key);
    if (retryAfter !== null)
        throw new HttpFailure(
            429,
            { error: 'too_many_requests' },
            { 'Retry-After': String(retryAfter) },
        );
    await limiter.hit(key);
}

const siteSchema = z.object({
    id: z.string(),
    tenant_id: z.string(),
    edition: z.string(),
    public_key: z.string(),
});
export type SignedSite = z.infer<typeof siteSchema>;

// Pendaftaran dibatasi sepuluh per menit per alamat IP, karena ia satu-satunya pintu agen tanpa tanda tangan.
export const enrollProcedure = base.use(async ({ context, next }) => {
    await throttle(context, `agent-enroll|${context.clientAddress}`, 10);
    return next();
});

// Situs ditentukan dari tanda tangan yang sudah diperiksa, tidak pernah dari isi request. Situs yang dicabut, belum
// terdaftar, atau tidak dikenal mendapat jawaban yang sama dengan tanda tangan yang salah.
export const signedProcedure = base.use(async ({ context, next }) => {
    const path = new URL(context.request.url).pathname;
    await throttle(
        context,
        `agent:${context.request.method} ${path}|${context.clientAddress}`,
        120,
    );
    const body = await context.rawBody();
    const headers = context.request.headers;
    const signature = parseSignature(
        {
            method: context.request.method,
            path,
            contentDigest: headers.get('content-digest'),
            signatureInput: headers.get('signature-input'),
            signature: headers.get('signature'),
        },
        body,
        Math.floor(Date.now() / 1000),
    );
    const siteId = signature ? fromAgentId(signature.keyId) : null;
    const site = siteId
        ? await context.db.one(
              siteSchema,
              `select id, tenant_id, edition, public_key from sites
               where id = $1 and public_key is not null and revoked_at is null`,
              [siteId],
          )
        : undefined;
    if (!signature || !site || !signature.verify(site.public_key)) {
        process.stderr.write(
            JSON.stringify({
                event: 'agent-signature-rejected',
                path,
                key_id: signature?.keyId.slice(0, 100) ?? null,
            }) + '\n',
        );
        throw agentError(401, 'signature_invalid');
    }
    return next({ context: { site, body } });
});
