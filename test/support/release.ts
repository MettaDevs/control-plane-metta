import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Rilis bertanda tangan seperti keluaran deploy/perakit/rakit.sh CoreERP: manifest v2, compose, update.sh,
// SHA256SUMS bergaya sha256sum, dan tanda tangan RSA-SHA256 atas SHA256SUMS.
export function releaseKeys() {
    const keys = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const directory = mkdtempSync(join(tmpdir(), 'release-key-'));
    const publicKeyPath = join(directory, 'release-public.pem');
    writeFileSync(publicKeyPath, keys.publicKey);
    return { ...keys, publicKeyPath };
}

export function signedRelease(
    privateKey: string,
    options: {
        project?: string;
        release?: string;
        compose?: string;
        manifest?: Record<string, unknown>;
        tamper?: 'checksum' | 'signature';
    } = {},
) {
    const project = options.project ?? 'coreerp';
    const release = options.release ?? '1.2.3';
    const sha = (text: string) =>
        createHash('sha256').update(text).digest('hex');
    const manifest = JSON.stringify({
        versi: 2,
        rilis: release,
        commit: 'a'.repeat(40),
        image: `${project}/core`,
        digest: 'sha256:' + 'b'.repeat(64),
        config_digest: 'sha256:' + 'c'.repeat(64),
        pendamping: [
            {
                nama: 'caddy',
                image: `${project}/pendamping/caddy`,
                digest: 'sha256:' + 'd'.repeat(64),
            },
        ],
        ...options.manifest,
    });
    const compose =
        options.compose ??
        'services:\n  core-app:\n    image: ${EDITION_IMAGE}\n';
    const update = '#!/usr/bin/env bash\nset -euo pipefail\necho update\n';
    const checksums =
        [
            `${sha(manifest)}  manifest.json`,
            `${options.tamper === 'checksum' ? sha('other') : sha(compose)}  compose.yaml`,
            `${sha(update)}  update.sh`,
        ].join('\n') + '\n';
    const signature = createSign('sha256')
        .update(options.tamper === 'signature' ? checksums + ' ' : checksums)
        .sign(privateKey);
    const form = new FormData();
    form.set('manifest', new Blob([manifest]), 'manifest.json');
    form.set('compose', new Blob([compose]), 'compose.yaml');
    form.set('update_script', new Blob([update]), 'update.sh');
    form.set('checksums', new Blob([checksums]), 'SHA256SUMS');
    form.set('signature', new Blob([signature]), 'SHA256SUMS.sig');
    return {
        form,
        files: { manifest, compose, update, checksums, signature },
        release,
    };
}
