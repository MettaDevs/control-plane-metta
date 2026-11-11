// Nama database lingkungan: dari slug tenant dan jenisnya supaya mudah dikenali operator, ditambah potongan id
// lingkungan supaya tidak pernah bertabrakan, dalam batas 63 karakter PostgreSQL.
export function environmentDatabaseName(
    tenantSlug: string,
    kind: string,
    environmentId: string,
): string {
    const suffix = environmentId.replaceAll('-', '').slice(-10);
    return `env_${tenantSlug.replaceAll('-', '_')}_${kind}`
        .slice(0, 63 - suffix.length - 1)
        .concat('_', suffix);
}
