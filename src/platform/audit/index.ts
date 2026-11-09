import type { Database } from '../database/index.ts';

export type AuditEvent = {
    // null untuk tindakan sistem, misalnya operator yang dibuat dari CLI.
    operatorId: string | null;
    action: string;
    subjectType: string;
    subjectId: string | null;
    // Tidak pernah memuat nilai rahasia. Catat bahwa rahasianya ada atau berubah, bukan isinya.
    detail?: Record<string, unknown>;
    ipAddress: string | null;
};

// Setiap tindakan operator yang mengubah sesuatu menulis satu baris di transaksi yang sama dengan perubahannya, jadi
// perubahan tanpa jejak dan jejak tanpa perubahan sama-sama tidak mungkin.
export async function recordAudit(
    db: Database,
    event: AuditEvent,
): Promise<void> {
    if (!db.inTransaction)
        throw new Error(
            `Audit ${event.action} must be written inside the transaction of the change it records.`,
        );
    // Lewat text: parameter yang bertipe jsonb di-encode lagi oleh postgres.js, sehingga tersimpan sebagai string JSON.
    await db.execute(
        `insert into operator_audit_events
            (id, operator_id, action, subject_type, subject_id, detail, ip_address, occurred_at)
         values ($1, $2, $3, $4, $5, $6::text::jsonb, $7, now() at time zone 'utc')`,
        [
            Bun.randomUUIDv7(),
            event.operatorId,
            event.action,
            event.subjectType,
            event.subjectId,
            JSON.stringify(event.detail ?? {}),
            event.ipAddress,
        ],
    );
}
