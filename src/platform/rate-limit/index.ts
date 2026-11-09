import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../database/index.ts';

type Limit = { maxAttempts: number; decaySeconds: number };

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

// Hitungan disimpan di rate_limits, jadi berlaku sama di setiap proses dan instance.
export class RateLimiter {
    constructor(
        private readonly db: Database,
        private readonly limit: Limit,
    ) {}

    // Detik sampai kunci boleh dicoba lagi, atau null bila belum mencapai batas.
    async retryAfter(key: string): Promise<number | null> {
        const row = await this.db.one(
            z.object({ hits: z.number(), seconds: z.number() }),
            `select hits, greatest(1, ceil(extract(epoch from reset_at - now())))::int as seconds
             from rate_limits where key = $1 and reset_at > now()`,
            [hash(key)],
        );
        return row && row.hits >= this.limit.maxAttempts ? row.seconds : null;
    }

    async hit(key: string): Promise<void> {
        await this.db.execute(
            `insert into rate_limits (key, hits, reset_at) values ($1, 1, now() + make_interval(secs => $2))
             on conflict (key) do update set
                hits = case when rate_limits.reset_at <= now() then 1 else rate_limits.hits + 1 end,
                reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end`,
            [hash(key), this.limit.decaySeconds],
        );
    }

    async clear(key: string): Promise<void> {
        await this.db.execute(
            'update rate_limits set hits = 0 where key = $1',
            [hash(key)],
        );
    }
}
