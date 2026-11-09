import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';

const releaseSchema = z.object({
    edition: z.string(),
    release: z.string(),
    image: z.string(),
    digest: z.string(),
    manifest: z.string(),
    compose: z.string(),
    update_script: z.string(),
    checksums: z.string(),
    signature: z.string(),
});
export type StoredRelease = z.infer<typeof releaseSchema>;

export async function findRelease(
    db: Database,
    edition: string,
    release: string,
): Promise<StoredRelease | null> {
    return (
        (await db.one(
            releaseSchema,
            `select edition, release, image, digest, manifest, compose, update_script, checksums, signature
             from site_releases where edition = $1 and release = $2`,
            [edition, release],
        )) ?? null
    );
}

const listedSchema = z.object({
    edition: z.string(),
    release: z.string(),
    image: z.string(),
    registered_at: z.string(),
});

export async function listReleases(db: Database) {
    return db.rows(
        listedSchema,
        `select edition, release, image, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as registered_at
         from site_releases order by created_at desc, id desc`,
    );
}

// Berkas rilis yang boleh diunduh agen, dengan isinya. SHA256SUMS.sig disimpan base64 dan dikirim sebagai byte.
export function releaseFile(
    release: StoredRelease,
    file: string,
): Uint8Array<ArrayBuffer> | null {
    const encode = (text: string) => new TextEncoder().encode(text);
    switch (file) {
        case 'manifest.json':
            return encode(release.manifest);
        case 'compose.yaml':
            return encode(release.compose);
        case 'update.sh':
            return encode(release.update_script);
        case 'SHA256SUMS':
            return encode(release.checksums);
        case 'SHA256SUMS.sig':
            return new Uint8Array(Buffer.from(release.signature, 'base64'));
        default:
            return null;
    }
}
