import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../../platform/database/index.ts';

// Token pendaftaran: 48 huruf dan angka acak, berlaku 60 menit, sekali pakai, dan disimpan hanya sebagai sha256 hex.
// Sama dengan konsol CoreERP, jadi perintah pasang yang sudah dibagikan tetap bermakna sama.
const tokenAlphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const tokenLength = 48;
const tokenLifetimeMinutes = 60;

const hashToken = (token: string) =>
    createHash('sha256').update(token).digest('hex');

// Token baru membatalkan token lama situs itu yang belum dipakai.
export async function issueEnrollmentToken(
    db: Database,
    siteId: string,
    createdBy: string | null,
): Promise<{ token: string }> {
    const token = Array.from(
        { length: tokenLength },
        () => tokenAlphabet[randomInt(tokenAlphabet.length)],
    ).join('');
    await db.transaction(async () => {
        await db.execute(
            `update site_enrollment_tokens set used_at = now() at time zone 'utc', updated_at = now() at time zone 'utc'
             where site_id = $1 and used_at is null`,
            [siteId],
        );
        await db.execute(
            `insert into site_enrollment_tokens (id, site_id, token_hash, expires_at, created_by, created_at, updated_at)
             values ($1, $2, $3, now() at time zone 'utc' + make_interval(mins => $4), $5,
                     now() at time zone 'utc', now() at time zone 'utc')`,
            [
                Bun.randomUUIDv7(),
                siteId,
                hashToken(token),
                tokenLifetimeMinutes,
                createdBy,
            ],
        );
    });
    return { token };
}

const enrolledSchema = z.object({
    site_id: z.string(),
    tenant_id: z.string(),
    tenant_name: z.string(),
    window_start: z.string().nullable(),
    window_end: z.string().nullable(),
    timezone: z.string(),
});
export type EnrolledSite = z.infer<typeof enrolledSchema>;

// Menukar token dengan kunci publik situs. Token yang tidak dikenal, sudah dipakai, kedaluwarsa, atau milik situs
// yang dicabut semuanya null, supaya penjawabnya tidak bisa membedakan. Situs yang sudah terdaftar boleh mendaftar
// ulang dengan token baru; kuncinya diganti.
export async function redeemEnrollmentToken(
    db: Database,
    token: string,
    publicKey: string,
): Promise<EnrolledSite | null> {
    return db.transaction(async () => {
        const held = await db.one(
            z.object({ id: z.string(), site_id: z.string() }),
            `select t.id, t.site_id from site_enrollment_tokens t join sites s on s.id = t.site_id
             where t.token_hash = $1 and t.used_at is null and t.expires_at > now() at time zone 'utc'
               and s.revoked_at is null
             for update of t, s`,
            [hashToken(token)],
        );
        if (!held) return null;
        await db.execute(
            `update site_enrollment_tokens set used_at = now() at time zone 'utc', updated_at = now() at time zone 'utc'
             where site_id = $1 and used_at is null`,
            [held.site_id],
        );
        await db.execute(
            `update sites set public_key = $2, enrolled_at = now() at time zone 'utc', updated_at = now() at time zone 'utc'
             where id = $1`,
            [held.site_id, publicKey],
        );
        return (
            (await db.one(
                enrolledSchema,
                `select s.id as site_id, s.tenant_id, t.name as tenant_name,
                        to_char(s.update_window_start, 'HH24:MI') as window_start,
                        to_char(s.update_window_end, 'HH24:MI') as window_end, s.timezone
                 from sites s join tenants t on t.id = s.tenant_id where s.id = $1`,
                [held.site_id],
            )) ?? null
        );
    });
}
