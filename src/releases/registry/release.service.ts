import { createHash, createVerify } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';

// Registri rilis, sama dengan konsol CoreERP. Rilis hanya diterima bila SHA256SUMS ditandatangani kunci privat rilis,
// yang tidak pernah dipegang control plane, sehingga control plane yang dibobol pun hanya bisa memilih di antara rilis
// yang sudah ada. Setiap image disebut lewat digest, karena tag bisa dipindahkan.
const releasePattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const repositoryPattern =
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;

export const releaseFiles = {
    'manifest.json': 'manifest',
    'compose.yaml': 'compose',
    'update.sh': 'update_script',
} as const;
export type ReleaseUpload = {
    manifest: string;
    compose: string;
    update_script: string;
    checksums: string;
    signature: Uint8Array;
};

const reject = (status: number, error: string, message: string): never => {
    throw new HttpFailure(status, { error, message });
};

// Nomor rilis tiga bagian dibandingkan per bagian sebagai angka: 0.10.0 lebih baru dari 0.9.1.
export function compareReleases(left: string, right: string): number {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < 3; index++) {
        const difference = (a[index] ?? 0) - (b[index] ?? 0);
        if (difference !== 0) return Math.sign(difference);
    }
    return 0;
}

function verifySignature(
    checksums: string,
    signature: Uint8Array,
    publicKeyPem: string | null,
): void {
    if (!publicKeyPem)
        return reject(
            422,
            'release_key_missing',
            'Kunci publik rilis belum disetel (CONSOLE_RELEASE_PUBLIC_KEY_PATH); pendaftaran rilis ditolak.',
        );
    let valid = false;
    try {
        valid = createVerify('sha256')
            .update(checksums)
            .verify(publicKeyPem, signature);
    } catch {
        valid = false;
    }
    if (!valid)
        reject(
            422,
            'signature_invalid',
            'Tanda tangan SHA256SUMS tidak sah terhadap kunci publik rilis.',
        );
}

function verifyChecksums(upload: ReleaseUpload): void {
    const listed = new Map<string, string>();
    for (const line of upload.checksums.trim().split(/\r?\n/)) {
        const [, hash, name] =
            /^([a-f0-9]{64}) [ *]?(\S+)$/.exec(line.trim()) ?? [];
        if (!hash || !name)
            return reject(
                422,
                'checksums_invalid',
                'SHA256SUMS memuat baris yang tidak dikenal.',
            );
        listed.set(name, hash);
    }
    const expected = Object.keys(releaseFiles).sort();
    if ([...listed.keys()].sort().join('\n') !== expected.join('\n'))
        reject(
            422,
            'checksums_invalid',
            'SHA256SUMS harus menyebut tepat manifest.json, compose.yaml, dan update.sh.',
        );
    for (const [name, field] of Object.entries(releaseFiles)) {
        const actual = createHash('sha256').update(upload[field]).digest('hex');
        if (listed.get(name) !== actual)
            reject(
                422,
                'checksums_invalid',
                `Checksum ${name} tidak cocok dengan isinya.`,
            );
    }
}

const companionSchema = z.object({
    nama: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/),
    image: z.string(),
    digest: z.string().regex(digestPattern),
});

// Manifest v2 dari rakit.sh: satu image untuk semua klien, di project registry sendiri, tanpa host. Rilis v2
// disimpan di bawah edisi bernama sama dengan project itu, karena agen mengunduh berkas rilis lewat edisi situsnya.
// Manifest v1 dari alur rilis GHCR sudah dibuang di CoreERP dan tidak diterima di sini.
function fromManifest(text: string, project: string) {
    let manifest: unknown;
    try {
        manifest = JSON.parse(text);
    } catch {
        reject(422, 'manifest_invalid', 'manifest.json bukan JSON.');
    }
    const parsed = z
        .object({
            versi: z.literal(2),
            rilis: z.string().max(40).regex(releasePattern),
            commit: z.string().regex(/^[a-f0-9]{40}$/),
            image: z.string(),
            digest: z.string().regex(digestPattern),
            config_digest: z.string().regex(digestPattern),
            pendamping: z.array(companionSchema),
        })
        .safeParse(manifest);
    if (!parsed.success)
        return reject(
            422,
            'manifest_invalid',
            'manifest.json harus berversi 2, menyebut nomor rilis bertitik, SHA commit sumbernya, image beserta digest manifest dan config-nya, dan daftar pendamping.',
        );
    const { rilis, image, digest, pendamping } = parsed.data;
    if (!image.startsWith(`${project}/`) || !repositoryPattern.test(image))
        reject(
            422,
            'manifest_invalid',
            `manifest v2 harus menyebut image di project ${project} tanpa host.`,
        );
    const names = new Set<string>();
    for (const companion of pendamping) {
        if (
            companion.image !== `${project}/pendamping/${companion.nama}` ||
            names.has(companion.nama)
        )
            reject(
                422,
                'manifest_invalid',
                `Pendamping di manifest v2 harus bernama unik, tinggal di ${project}/pendamping/<nama>, dan disebut lewat digest.`,
            );
        names.add(companion.nama);
    }
    return {
        edition: project,
        release: rilis,
        image: `${image}@${digest}`,
        digest,
    };
}

const storedSchema = z.object({
    manifest: z.string(),
    compose: z.string(),
    update_script: z.string(),
    checksums: z.string(),
});

// Rilis baru dicatat; rilis yang sama persis dianggap pendaftaran ulang; isi berbeda untuk nomor yang sama ditolak.
export async function registerRelease(
    db: Database,
    upload: ReleaseUpload,
    settings: { publicKeyPem: string | null; project: string | null },
): Promise<{ edition: string; release: string; created: boolean }> {
    verifySignature(upload.checksums, upload.signature, settings.publicKeyPem);
    verifyChecksums(upload);
    if (!settings.project)
        return reject(
            422,
            'release_key_missing',
            'Project registry rilis belum disetel (CONSOLE_REGISTRY_PROJECT); pendaftaran rilis ditolak.',
        );
    const release = fromManifest(upload.manifest, settings.project);
    return db.transaction(async () => {
        const inserted = await db.execute(
            `insert into site_releases (id, edition, release, image, digest, manifest, compose, update_script, checksums,
                                        signature, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() at time zone 'utc', now() at time zone 'utc')
             on conflict (edition, release) do nothing`,
            [
                Bun.randomUUIDv7(),
                release.edition,
                release.release,
                release.image,
                release.digest,
                upload.manifest,
                upload.compose,
                upload.update_script,
                upload.checksums,
                Buffer.from(upload.signature).toString('base64'),
            ],
        );
        if (!inserted) {
            const existing = await db.one(
                storedSchema,
                'select manifest, compose, update_script, checksums from site_releases where edition = $1 and release = $2',
                [release.edition, release.release],
            );
            const same =
                existing?.manifest === upload.manifest &&
                existing.compose === upload.compose &&
                existing.update_script === upload.update_script &&
                existing.checksums === upload.checksums;
            if (!same)
                reject(
                    409,
                    'release_conflict',
                    `Edisi ${release.edition} rilis ${release.release} sudah terdaftar dengan isi berbeda. Rakit ulang dengan nomor rilis berikutnya.`,
                );
        }
        return {
            edition: release.edition,
            release: release.release,
            created: inserted > 0,
        };
    });
}
