import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';
import type { Report } from './report.schema.ts';

// Bidang yang bergerak di setiap laporan tanpa keadaan server berubah. Riwayat laporan hanya bertambah bila sisanya
// berubah; angka feed finance bergerak bersama transaksi klinik, bukan bersama keadaan server.
const volatile = new Set(['created_at', 'server_time', 'disk', 'finance_feed']);

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => (left < right ? -1 : 1))
                .map(([key, item]) => [key, canonical(item)]),
        );
    return value;
}

export function reportHash(report: Report): string {
    const stable = Object.fromEntries(
        Object.entries(report).filter(([key]) => !volatile.has(key)),
    );
    return createHash('sha256')
        .update(JSON.stringify(canonical(stable)))
        .digest('hex');
}

// Laporan terakhir selalu menimpa keadaan situs; riwayatnya bertambah satu baris hanya bila isinya berubah.
export async function recordReport(
    db: Database,
    siteId: string,
    report: Report,
    clientAddress: string,
): Promise<void> {
    const hash = reportHash(report);
    const payload = JSON.stringify(report);
    await db.transaction(async () => {
        await db.execute(
            `update sites set reported_edition = $2, reported_release = $3, reported_digest = $4,
                last_seen_at = now() at time zone 'utc', last_seen_ip = coalesce($5, last_seen_ip),
                last_report = $6::text::jsonb, updated_at = now() at time zone 'utc'
             where id = $1`,
            [
                siteId,
                report.edition ?? null,
                report.release ?? null,
                report.digest ?? null,
                isIP(clientAddress) ? clientAddress : null,
                payload,
            ],
        );
        const latest = await db.one(
            z.object({ payload_hash: z.string() }),
            `select payload_hash from site_reports where site_id = $1 order by received_at desc, id desc limit 1`,
            [siteId],
        );
        if (latest?.payload_hash === hash) return;
        await db.execute(
            `insert into site_reports (id, site_id, payload, payload_hash, reported_at, received_at, created_at, updated_at)
             values ($1, $2, $3::text::jsonb, $4, $5::text::timestamptz at time zone 'utc', now() at time zone 'utc',
                     now() at time zone 'utc', now() at time zone 'utc')`,
            [Bun.randomUUIDv7(), siteId, payload, hash, report.created_at],
        );
    });
}
