import type { Database } from '../../src/platform/database/index.ts';

// Situs on-prem beserta client dan tenant pemiliknya, langsung di database, karena layar pembuat situs belum ada.
export async function createSite(
    db: Database,
    options: { tenantName?: string; window?: [string, string] } = {},
): Promise<{ siteId: string; tenantId: string }> {
    const suffix = crypto.randomUUID().slice(0, 8);
    const clientId = Bun.randomUUIDv7();
    const tenantId = Bun.randomUUIDv7();
    const siteId = Bun.randomUUIDv7();
    await db.execute(
        `insert into clients (id, legal_name, slug, created_at, updated_at)
         values ($1, $2, $3, now(), now())`,
        [clientId, `Client ${suffix}`, `client-${suffix}`],
    );
    await db.execute(
        `insert into tenants (id, client_id, name, slug, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [
            tenantId,
            clientId,
            options.tenantName ?? `Klinik ${suffix}`,
            `klinik-${suffix}`,
        ],
    );
    await db.execute(
        `insert into sites (id, tenant_id, name, profile, edition, update_window_start, update_window_end,
                            created_at, updated_at)
         values ($1, $2, $3, 'managed_on_prem', 'coreerp', $4::text::time, $5::text::time, now(), now())`,
        [
            siteId,
            tenantId,
            `Server ${suffix}`,
            options.window?.[0] ?? null,
            options.window?.[1] ?? null,
        ],
    );
    return { siteId, tenantId };
}
