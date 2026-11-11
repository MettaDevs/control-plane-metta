import { createHash, createPublicKey } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';

export const runtimeHostInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    public_key: z.string().min(1),
});

// Penolakan karena isi yang salah, bukan kesalahan program; CLI tidak mengirimnya ke Sentry.
export class RuntimeHostRejected extends Error {}

// Sidik SHA-256 atas kunci publik dalam bentuk DER, sama dengan yang dicetak saat host didaftarkan.
function keyFingerprint(pem: string): string {
    return createHash('sha256')
        .update(createPublicKey(pem).export({ type: 'spki', format: 'der' }))
        .digest('hex');
}

// Kunci publik RSA worker. Kunci lain ditolak, karena API worker hanya memeriksa rsa-v1_5-sha256.
export async function addRuntimeHost(
    db: Database,
    input: z.infer<typeof runtimeHostInputSchema>,
): Promise<{ id: string; fingerprint: string }> {
    let key;
    try {
        key = createPublicKey(input.public_key);
    } catch {
        throw new RuntimeHostRejected(
            'The public key is not a PEM public key.',
        );
    }
    if (key.asymmetricKeyType !== 'rsa')
        throw new RuntimeHostRejected('The public key must be an RSA key.');
    const pem = key.export({ type: 'spki', format: 'pem' }).toString();
    const fingerprint = keyFingerprint(pem);
    const id = Bun.randomUUIDv7();
    return db.transaction(async () => {
        try {
            await db.execute(
                "insert into runtime_hosts (id, name, public_key, created_at) values ($1, $2, $3, now() at time zone 'utc')",
                [id, input.name, pem],
            );
        } catch (error) {
            if (sqlErrorCode(error) === '23505')
                throw new RuntimeHostRejected(
                    `A runtime host named ${input.name} already exists.`,
                );
            throw error;
        }
        await recordAudit(db, {
            operatorId: null,
            action: 'runtime_host.added',
            subjectType: 'runtime_host',
            subjectId: id,
            detail: { name: input.name, key_fingerprint: fingerprint },
            ipAddress: null,
        });
        return { id, fingerprint };
    });
}

// Host yang laporan terakhirnya lebih tua dari ini dianggap berhenti melapor. Worker melapor setiap lima menit secara
// bawaan, jadi tiga laporan yang hilang berturut-turut sudah cukup untuk berhenti menempatkan lingkungan baru di sana.
export const reportStaleMinutes = 15;

export const hostRings = ['canary', 'early', 'general'] as const;

// Keadaan penempatan host h, dihitung di satu tempat supaya daftar host, penempatan otomatis, dan pilihan operator
// memakai aturan yang sama: dicabut, berhenti melapor (atau belum pernah), tidak menerima lingkungan baru, penuh,
// atau tersedia.
const liveEnvironments =
    '(select count(*) from environments e where e.runtime_host_id = h.id and e.purged_at is null)';
const availability = `case
    when h.revoked_at is not null then 'revoked'
    when h.reported_at is null
        or h.reported_at < now() at time zone 'utc' - make_interval(mins => ${reportStaleMinutes}) then 'silent'
    when not h.accepts_new then 'paused'
    when h.capacity is not null and ${liveEnvironments} >= h.capacity then 'full'
    else 'available' end`;
export const hostAvailabilities = [
    'revoked',
    'silent',
    'paused',
    'full',
    'available',
] as const;
export type HostAvailability = (typeof hostAvailabilities)[number];

function unavailableReason(
    availability: Exclude<HostAvailability, 'available'>,
): string {
    switch (availability) {
        case 'revoked':
            return 'Host runtime ini sudah dicabut.';
        case 'silent':
            return `Host runtime ini tidak melapor dalam ${String(reportStaleMinutes)} menit terakhir, jadi lingkungan baru tidak ditempatkan di sana.`;
        case 'paused':
            return 'Host runtime ini sedang tidak menerima lingkungan baru.';
        case 'full':
            return 'Host runtime ini sudah mencapai kapasitasnya.';
        default: {
            const unknown: never = availability;
            return unknown;
        }
    }
}

// Penempatan lingkungan baru adalah keputusan control plane, bukan host yang kebetulan paling cepat meminta pekerjaan.
// Operator boleh memilih host yang tersedia, termasuk host khusus. Tanpa pilihan, host tersedia yang bukan host khusus
// dengan lingkungan hidup paling sedikit yang dipakai.
export async function placeEnvironment(
    db: Database,
    chosen: string | undefined,
): Promise<string> {
    if (chosen) {
        const host = await db.one(
            z.object({
                id: z.string(),
                availability: z.enum(hostAvailabilities),
            }),
            `select h.id, ${availability} as availability from runtime_hosts h where h.id = $1`,
            [chosen],
        );
        const refuse = (reason: string): never => {
            throw new HttpFailure(422, {
                message: 'Periksa isian customer baru.',
                errors: { runtime_host_id: [reason] },
            });
        };
        if (!host) return refuse('Host runtime ini tidak ada.');
        if (host.availability !== 'available')
            return refuse(unavailableReason(host.availability));
        return host.id;
    }
    const host = await db.one(
        z.object({ id: z.string() }),
        `select h.id from runtime_hosts h where not h.dedicated and ${availability} = 'available'
         order by ${liveEnvironments}, h.name limit 1`,
    );
    if (!host)
        throw new HttpFailure(409, {
            error: 'no_runtime_host',
            message:
                'Tidak ada host runtime yang tersedia untuk penempatan otomatis: semua dicabut, khusus, penuh, tidak menerima lingkungan baru, atau tidak melapor.',
        });
    return host.id;
}

export const runtimeHostSettingsSchema = z.strictObject({
    accepts_new: z.boolean(),
    capacity: z
        .number('Isi kapasitas dengan angka, atau kosongkan untuk tanpa batas.')
        .int('Kapasitas berupa bilangan bulat.')
        .positive('Kapasitas paling sedikit 1.')
        .max(100000)
        .nullable(),
    dedicated: z.boolean(),
    ring: z.enum(hostRings),
});
export type RuntimeHostSettings = z.infer<typeof runtimeHostSettingsSchema>;

export async function updateRuntimeHostSettings(
    db: Database,
    actor: { operatorId: string; ipAddress: string | null },
    hostId: string,
    settings: RuntimeHostSettings,
): Promise<void> {
    await db.transaction(async () => {
        const updated = await db.execute(
            'update runtime_hosts set accepts_new = $2, capacity = $3, dedicated = $4, ring = $5 where id = $1 and revoked_at is null',
            [
                hostId,
                settings.accepts_new,
                settings.capacity,
                settings.dedicated,
                settings.ring,
            ],
        );
        if (updated === 0)
            throw new HttpFailure(404, {
                error: 'runtime_host_not_found',
                message: 'Host runtime tidak ditemukan atau sudah dicabut.',
            });
        await recordAudit(db, {
            ...actor,
            action: 'runtime_host.settings_changed',
            subjectType: 'runtime_host',
            subjectId: hostId,
            detail: settings,
        });
    });
}

const hostRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    public_key: z.string(),
    created_at: z.string(),
    revoked_at: z.string().nullable(),
    reported_release: z.string().nullable(),
    reported_at: z.string().nullable(),
    accepts_new: z.boolean(),
    capacity: z.number().nullable(),
    dedicated: z.boolean(),
    ring: z.enum(hostRings),
    availability: z.enum(hostAvailabilities),
    environments: z.number(),
    open_operations: z.number(),
});

// Setiap host runtime dengan jumlah lingkungan yang terikat kepadanya dan operasi lingkungan itu yang masih terbuka.
export async function listRuntimeHosts(db: Database) {
    const rows = await db.rows(
        hostRowSchema,
        `select h.id, h.name, h.public_key,
            to_char(h.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
            to_char(h.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as revoked_at, h.reported_release,
            to_char(h.reported_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as reported_at,
            h.accepts_new, h.capacity, h.dedicated, h.ring, ${availability} as availability,
            (select count(*)::int from environments e where e.runtime_host_id = h.id and e.deleted_at is null)
                as environments,
            (select count(*)::int from environment_operations o join environments e on e.id = o.environment_id
             where e.runtime_host_id = h.id and o.status in ('requested', 'running')) as open_operations
         from runtime_hosts h order by h.revoked_at is not null, h.name`,
    );
    return rows.map(({ public_key, ...host }) => ({
        ...host,
        fingerprint: keyFingerprint(public_key),
    }));
}

// Mencabut host: tanda tangan worker-nya langsung ditolak. Lingkungan yang terikat ke host itu tetap terikat, karena
// databasenya ada di sana; operasinya tidak diambil host lain, dan operasi yang sedang berjalan ditutup gagal begitu
// tenggatnya lewat.
export async function revokeRuntimeHost(
    db: Database,
    actor: { operatorId: string; ipAddress: string | null },
    hostId: string,
): Promise<void> {
    await db.transaction(async () => {
        const host = await db.one(
            z.object({ revoked: z.boolean() }),
            'select revoked_at is not null as revoked from runtime_hosts where id = $1 for update',
            [hostId],
        );
        if (!host)
            throw new HttpFailure(404, {
                error: 'runtime_host_not_found',
                message: 'Host runtime tidak ditemukan.',
            });
        if (host.revoked)
            throw new HttpFailure(409, {
                error: 'runtime_host_revoked',
                message: 'Host runtime ini sudah dicabut.',
            });
        await db.execute(
            "update runtime_hosts set revoked_at = now() at time zone 'utc' where id = $1",
            [hostId],
        );
        await recordAudit(db, {
            ...actor,
            action: 'runtime_host.revoked',
            subjectType: 'runtime_host',
            subjectId: hostId,
        });
    });
}
