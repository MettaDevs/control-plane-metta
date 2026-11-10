import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import type { Database } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import { issueEnrollmentToken } from '../enrollment/enrollment.service.ts';

// Situs yang terdaftar dianggap basi bila laporannya berhenti lebih dari tiga menit, sama dengan konsol CoreERP.
const staleAfterSeconds = 180;
const iso = (column: string) =>
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

const siteColumns = `s.id, s.name, s.tenant_id, t.name as tenant_name, s.server_address, s.edition, s.reported_release,
    ${iso('s.last_seen_at')} as last_seen_at,
    case when s.revoked_at is not null then 'revoked'
         when s.public_key is null then 'not_enrolled'
         when s.last_seen_at is null or s.last_seen_at < now() at time zone 'utc' - make_interval(secs => ${staleAfterSeconds}) then 'stale'
         else 'active' end as state`;

export const siteSchema = z.object({
    id: z.string(),
    name: z.string(),
    tenant_id: z.string(),
    tenant_name: z.string(),
    server_address: z.string().nullable(),
    edition: z.string(),
    reported_release: z.string().nullable(),
    last_seen_at: z.string().nullable(),
    state: z.enum(['not_enrolled', 'active', 'stale', 'revoked']),
});
export type Site = z.infer<typeof siteSchema>;

const operationSchema = z.object({
    id: z.string(),
    operation: z.string(),
    status: z.string(),
    step: z.string().nullable(),
    failure_message: z.string().nullable(),
    requested_at: z.string(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
});

export async function listSites(db: Database): Promise<Site[]> {
    return db.rows(
        siteSchema,
        `select ${siteColumns} from sites s join tenants t on t.id = s.tenant_id order by s.name, s.id`,
    );
}

// Situs beserta 50 operasi terakhirnya.
export async function findSite(db: Database, siteId: string) {
    const site = await db.one(
        siteSchema,
        `select ${siteColumns} from sites s join tenants t on t.id = s.tenant_id where s.id = $1`,
        [siteId],
    );
    if (!site)
        throw new HttpFailure(404, {
            error: 'site_not_found',
            message: 'Situs tidak ditemukan.',
        });
    const operations = await db.rows(
        operationSchema,
        `select id, operation, status, step, failure_message, ${iso('requested_at')} as requested_at,
                ${iso('started_at')} as started_at, ${iso('finished_at')} as finished_at
         from site_operations where site_id = $1 order by requested_at desc, id desc limit 50`,
        [siteId],
    );
    return { ...site, operations };
}

// Token pendaftaran untuk server klien. Nilai token hanya ada di jawaban ini; jejak audit dan database tidak
// menyimpannya.
export async function issueSiteEnrollmentToken(
    db: Database,
    actor: { operatorId: string; ipAddress: string },
    siteId: string,
): Promise<{ token: string }> {
    return db.transaction(async () => {
        const site = await db.one(
            z.object({ revoked: z.boolean() }),
            'select revoked_at is not null as revoked from sites where id = $1 for update',
            [siteId],
        );
        if (!site)
            throw new HttpFailure(404, {
                error: 'site_not_found',
                message: 'Situs tidak ditemukan.',
            });
        if (site.revoked)
            throw new HttpFailure(409, {
                error: 'site_revoked',
                message: 'Situs ini sudah dicabut.',
            });
        const issued = await issueEnrollmentToken(db, siteId, actor.operatorId);
        await recordAudit(db, {
            ...actor,
            action: 'site.enrollment_token.issued',
            subjectType: 'site',
            subjectId: siteId,
        });
        return issued;
    });
}
