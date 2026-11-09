import { afterAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { loadConfig } from '../config/index.ts';
import { createPool, Database, sqlErrorCode } from '../database/index.ts';
import { recordAudit } from './index.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('operator audit', () => {
    if (!process.env.DB_HOST) return;
    const pool = createPool(
        loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 4).toString('base64'),
        }),
    );
    afterAll(() => pool.end());

    const event = (subjectId: string) => ({
        operatorId: null,
        action: 'test.recorded',
        subjectType: 'test',
        subjectId,
        detail: { secret_present: true },
        ipAddress: '203.0.113.9',
    });

    test('refuses to write outside a transaction', async () => {
        const db = new Database(pool);
        try {
            await expect(
                recordAudit(db, event(crypto.randomUUID())),
            ).rejects.toThrow('inside the transaction');
        } finally {
            await db.release();
        }
    });

    test('rolls back with the change it records, and cannot be edited', async () => {
        const db = new Database(pool);
        const kept = crypto.randomUUID();
        const rolledBack = crypto.randomUUID();
        try {
            await db.transaction(() => recordAudit(db, event(kept)));
            await expect(
                db.transaction(async () => {
                    await recordAudit(db, event(rolledBack));
                    throw new Error('the change failed');
                }),
            ).rejects.toThrow('the change failed');
            const rows = await db.rows(
                z.object({ subject_id: z.string(), detail: z.unknown() }),
                'select subject_id, detail from operator_audit_events where subject_id in ($1, $2)',
                [kept, rolledBack],
            );
            expect(rows).toEqual([
                { subject_id: kept, detail: { secret_present: true } },
            ]);
            const edit = await db
                .execute(
                    "update operator_audit_events set action = 'changed' where subject_id = $1",
                    [kept],
                )
                .catch((error: unknown) => sqlErrorCode(error));
            expect(edit).toBe('P0001');
        } finally {
            await db.release();
        }
    });
});
