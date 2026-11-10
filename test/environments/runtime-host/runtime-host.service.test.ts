import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import {
    addRuntimeHost,
    RuntimeHostRejected,
} from '../../../src/environments/index.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';

describe.skipIf(!process.env.DB_HOST)('runtime hosts', () => {
    if (!process.env.DB_HOST) return;
    const pool = createPool(
        loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 22).toString('base64'),
        }),
    );
    const db = new Database(pool);
    afterAll(async () => {
        await db.release();
        await pool.end();
    });
    const rsa = () =>
        generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        }).publicKey;

    test('kunci RSA tercatat dengan jejak audit berisi sidik jari, bukan kuncinya', async () => {
        const name = `host-${crypto.randomUUID()}`;
        const key = rsa();
        const host = await addRuntimeHost(db, { name, public_key: key });
        expect(host.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        const [audit] = await pool.unsafe(
            "select detail from operator_audit_events where action = 'runtime_host.added' and subject_id = $1",
            [host.id],
        );
        expect(audit?.detail).toEqual({
            name,
            key_fingerprint: host.fingerprint,
        });
        await expect(
            addRuntimeHost(db, { name, public_key: rsa() }),
        ).rejects.toBeInstanceOf(RuntimeHostRejected);
    });

    test('kunci yang bukan PEM atau bukan RSA ditolak', async () => {
        const ed25519 = generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        }).publicKey;
        for (const publicKey of ['bukan kunci', ed25519])
            await expect(
                addRuntimeHost(db, {
                    name: `host-${crypto.randomUUID()}`,
                    public_key: publicKey,
                }),
            ).rejects.toBeInstanceOf(RuntimeHostRejected);
    });
});
