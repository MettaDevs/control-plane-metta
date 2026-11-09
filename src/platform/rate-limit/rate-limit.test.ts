import { afterAll, describe, expect, test } from 'bun:test';
import { loadConfig } from '../config/index.ts';
import { createPool, Database } from '../database/index.ts';
import { RateLimiter } from './index.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('rate limiter', () => {
    if (!process.env.DB_HOST) return;
    const pool = createPool(
        loadConfig({
            ...process.env,
            APP_KEY: 'base64:' + Buffer.alloc(32, 5).toString('base64'),
        }),
    );
    afterAll(() => pool.end());

    test('blocks after the limit and opens again after clear', async () => {
        const db = new Database(pool);
        const limiter = new RateLimiter(db, {
            maxAttempts: 3,
            decaySeconds: 60,
        });
        const key = `test:${crypto.randomUUID()}`;
        try {
            for (let attempt = 0; attempt < 2; attempt++)
                await limiter.hit(key);
            expect(await limiter.retryAfter(key)).toBeNull();
            await limiter.hit(key);
            const wait = await limiter.retryAfter(key);
            expect(wait).toBeGreaterThan(0);
            expect(wait).toBeLessThanOrEqual(60);
            await limiter.clear(key);
            expect(await limiter.retryAfter(key)).toBeNull();
        } finally {
            await db.release();
        }
    });

    test('starts counting again once the window has passed', async () => {
        const db = new Database(pool);
        const limiter = new RateLimiter(db, {
            maxAttempts: 1,
            decaySeconds: 1,
        });
        const key = `test:${crypto.randomUUID()}`;
        try {
            await limiter.hit(key);
            expect(await limiter.retryAfter(key)).not.toBeNull();
            await Bun.sleep(1_100);
            expect(await limiter.retryAfter(key)).toBeNull();
            await limiter.hit(key);
            expect(await limiter.retryAfter(key)).not.toBeNull();
        } finally {
            await db.release();
        }
    });
});
