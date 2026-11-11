import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';

const now = "now() at time zone 'utc'";

export const hostReportSchema = z.strictObject({
    release: z.string().min(1).max(80),
    environments: z
        .array(
            z.strictObject({
                tenant_slug: z.string().min(1).max(63),
                kind: z.enum(['production', 'sandbox', 'demo']),
                database: z.string().min(1).max(63).nullable(),
                healthy: z.boolean(),
                problem: z.string().max(500).nullable(),
                size_bytes: z.number().int().nonnegative().nullable(),
                // Migration terakhir per pemilik: { core: '0013_…', 'asset-management': '0003_…' }.
                migrations: z.record(z.string(), z.string()),
            }),
        )
        .max(5000),
});
export type HostReport = z.infer<typeof hostReportSchema>;

// Menyimpan laporan terakhir host dan lingkungannya. Lingkungan dicocokkan hanya di antara milik host ini: lewat nama
// database untuk yang punya database sendiri, lewat slug tenant dan jenisnya untuk database bersama. Alamat yang tidak
// dikenal registri dihitung, tidak dibuat, karena registri lingkungan milik control plane.
export async function recordHostReport(
    db: Database,
    hostId: string,
    report: HostReport,
): Promise<{ matched: number; unknown: number }> {
    return db.transaction(async () => {
        await db.execute(
            `update runtime_hosts set reported_release = $2, reported_at = ${now} where id = $1`,
            [hostId, report.release],
        );
        let matched = 0;
        for (const environment of report.environments) {
            const updated = await db.execute(
                `update environments e set reported_migrations = $5::text::jsonb, reported_size_bytes = $6,
                    reported_healthy = $7, reported_problem = $8, reported_at = ${now}
                 from tenants t
                 where t.id = e.tenant_id and e.runtime_host_id = $1 and e.purged_at is null
                   and (e.database_name = $2
                        or ($2::text is null and e.database_name is null and t.slug = $3 and e.kind = $4))`,
                [
                    hostId,
                    environment.database,
                    environment.tenant_slug,
                    environment.kind,
                    JSON.stringify(environment.migrations),
                    environment.size_bytes,
                    environment.healthy,
                    environment.problem,
                ],
            );
            matched += updated;
        }
        return { matched, unknown: report.environments.length - matched };
    });
}
