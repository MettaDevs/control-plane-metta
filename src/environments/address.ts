// Alamat lingkungan menurut aturan operations-metta (`environmentHost` di repo itu): produksi di `<tenant>.<host>`, demo
// dan sandbox di `<tenant>.<jenis>.<host>`. Skema, host, dan port diambil dari OPERATIONS_URL; tanpa setelan itu alamatnya
// tidak diketahui (null).
export function environmentAddress(
    operationsUrl: string | undefined,
    tenantSlug: string,
    kind: 'production' | 'sandbox' | 'demo',
): string | null {
    if (!operationsUrl) return null;
    const base = new URL(operationsUrl);
    const host =
        kind === 'production'
            ? `${tenantSlug}.${base.hostname}`
            : `${tenantSlug}.${kind}.${base.hostname}`;
    return `${base.protocol}//${host}${base.port ? `:${base.port}` : ''}`;
}
