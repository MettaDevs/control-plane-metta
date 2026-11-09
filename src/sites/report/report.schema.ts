import { z } from 'zod';

// Laporan agen sesuai skema Report di contracts/agent/openapi.yaml. Setiap objek tertutup: kunci di luar skema, di
// tingkat mana pun, menolak seluruh laporan. Itu yang menegakkan data apa saja yang boleh keluar dari server klien.
const dateTime = z.iso.datetime({ offset: true });
const utcSecond = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    .nullable();
const count = z.int().min(0);

const financeFeedSchema = z
    .strictObject({
        counts: z.strictObject({
            held: count,
            pending: count,
            posted: count,
            rejected: count,
            manual: count,
        }),
        oldest_pending_at: utcSecond,
        last_pulled_at: utcSecond,
        last_pushed_at: utcSecond.optional(),
        failed_pushes: count.optional(),
    })
    .nullable();

export const reportSchema = z.strictObject({
    site_id: z.string(),
    agent_version: z.string().max(40),
    created_at: dateTime,
    server_time: dateTime,
    edition: z.string().max(80).nullable().optional(),
    release: z.string().max(40).nullable().optional(),
    image: z.string().max(255).nullable().optional(),
    digest: z.string().max(100).nullable().optional(),
    containers: z
        .array(
            z.strictObject({
                service: z.string().max(60),
                state: z.string().max(30),
                health: z.string().max(30).nullable().optional(),
            }),
        )
        .max(20)
        .optional(),
    disk: z
        .strictObject({
            data_free_bytes: z.int().nullable().optional(),
            backup_free_bytes: z.int().nullable().optional(),
        })
        .nullable()
        .optional(),
    last_backup: z
        .strictObject({
            at: dateTime,
            size_bytes: z.int().nullable().optional(),
            result: z.enum(['succeeded', 'failed']),
        })
        .nullable()
        .optional(),
    last_operation: z
        .strictObject({
            id: z.string(),
            result: z.enum(['succeeded', 'failed']),
            step: z.string().max(120).nullable().optional(),
        })
        .nullable()
        .optional(),
    certificate_expires_at: dateTime.nullable().optional(),
    license_expires_at: z.iso.date().nullable().optional(),
    license_perpetual: z.boolean().nullable().optional(),
    license_required: z.boolean().nullable().optional(),
    finance_feed: financeFeedSchema.optional(),
});
export type Report = z.infer<typeof reportSchema>;
