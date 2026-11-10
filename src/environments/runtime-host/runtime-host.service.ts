import { createHash, createPublicKey } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import { type Database, sqlErrorCode } from '../../platform/database/index.ts';

export const runtimeHostInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    public_key: z.string().min(1),
});

// Penolakan karena isi yang salah, bukan kesalahan program; CLI tidak mengirimnya ke Sentry.
export class RuntimeHostRejected extends Error {}

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
    const fingerprint = createHash('sha256')
        .update(key.export({ type: 'spki', format: 'der' }))
        .digest('hex');
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
