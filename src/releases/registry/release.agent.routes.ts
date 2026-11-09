import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Config } from '../../platform/config/index.ts';
import { base, HttpFailure } from '../../platform/http/index.ts';
import { RateLimiter } from '../../platform/rate-limit/index.ts';
import { registerRelease, type ReleaseUpload } from './release.service.ts';

const maxFileBytes = 1024 * 1024;
const digest = (value: string) => createHash('sha256').update(value).digest();

// POST /api/releases/v1 dipanggil alur rilis (rakit.sh) dengan token bearer, berisi lima berkas multipart. Dilayani
// proses agen, karena keduanya pintu publik yang tidak dipanggil dari browser operator.
export function releaseAgentRoutes(config: Config) {
    const publicKeyPem = config.CONSOLE_RELEASE_PUBLIC_KEY_PATH
        ? readFileSync(config.CONSOLE_RELEASE_PUBLIC_KEY_PATH, 'utf8')
        : null;
    return {
        registerRelease: base
            .route({
                method: 'POST',
                path: '/api/releases/v1',
                outputStructure: 'detailed',
            })
            .handler(async ({ context }) => {
                const limiter = new RateLimiter(context.db, {
                    maxAttempts: 30,
                    decaySeconds: 60,
                });
                const key = `release-register|${context.clientAddress}`;
                const retryAfter = await limiter.retryAfter(key);
                if (retryAfter !== null)
                    throw new HttpFailure(
                        429,
                        { error: 'too_many_requests' },
                        { 'Retry-After': String(retryAfter) },
                    );
                await limiter.hit(key);

                // Tanpa token yang disetel, setiap pendaftaran ditolak.
                const given = /^Bearer (.+)$/.exec(
                    context.request.headers.get('authorization') ?? '',
                )?.[1];
                if (
                    !config.CONSOLE_RELEASE_TOKEN ||
                    !given ||
                    !timingSafeEqual(
                        digest(given),
                        digest(config.CONSOLE_RELEASE_TOKEN),
                    )
                )
                    throw new HttpFailure(401, {
                        error: 'release_token_invalid',
                        message: 'Token rilis tidak sah.',
                    });

                const upload = await readUpload(
                    await context.rawBody(),
                    context.request.headers.get('content-type') ?? '',
                );
                const registered = await registerRelease(context.db, upload, {
                    publicKeyPem,
                    project: config.CONSOLE_REGISTRY_PROJECT ?? null,
                });
                return {
                    status: registered.created ? 201 : 200,
                    headers: {},
                    body: {
                        edition: registered.edition,
                        release: registered.release,
                    },
                };
            }),
    };
}

async function readUpload(
    body: Uint8Array<ArrayBuffer>,
    contentType: string,
): Promise<ReleaseUpload> {
    const invalid = (message: string) =>
        new HttpFailure(422, { error: 'invalid_request', message });
    let form: FormData;
    try {
        form = await new Response(body, {
            headers: { 'content-type': contentType },
        }).formData();
    } catch {
        throw invalid('Isi permintaan harus multipart/form-data.');
    }
    const file = async (name: string) => {
        const value = form.get(name);
        if (!(value instanceof Blob) || value.size > maxFileBytes)
            throw invalid(`Berkas ${name} wajib ada dan paling besar 1 MiB.`);
        return value;
    };
    return {
        manifest: await (await file('manifest')).text(),
        compose: await (await file('compose')).text(),
        update_script: await (await file('update_script')).text(),
        checksums: await (await file('checksums')).text(),
        signature: new Uint8Array(
            await (await file('signature')).arrayBuffer(),
        ),
    };
}
