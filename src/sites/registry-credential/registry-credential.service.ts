import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import type { Config } from '../../platform/config/index.ts';
import type { Database } from '../../platform/database/index.ts';
import { HttpFailure } from '../../platform/http/index.ts';
import { registry, RegistryUnavailable } from '../../releases/index.ts';
import { toAgentId } from '../agent-id.ts';

// Satu robot Harbor pull-only per operasi install atau upgrade, sama dengan konsol CoreERP. Robot lahir saat agen yang
// memegang operasi memintanya, dan dihapus begitu operasinya tidak lagi dipegang. Tidak ada penjadwal: sapuan
// berjalan setiap kali agen mengambil operasi atau menutupnya, dan saat situs dicabut. Robot yang gagal dihapus
// tetap tercatat di barisnya dan dicoba lagi pada sapuan berikutnya; umur robot di Harbor adalah penjaga terakhir.
const held = `operation in ('install', 'upgrade') and status = 'running' and lease_until > now() at time zone 'utc'`;

const notHeld = () => new HttpFailure(409, { error: 'operation_not_held' });

function robotName(operationId: string): string {
    const suffix = Array.from({ length: 6 }, () =>
        'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(randomInt(36)),
    ).join('');
    return `situs-${toAgentId(operationId).toLowerCase()}-${suffix}`;
}

const robotRowSchema = z.object({
    id: z.string(),
    operation: z.string(),
    robot_id: z.coerce.number().nullable(),
    robot_name: z.string().nullable(),
    held: z.boolean(),
});

async function forgetRobot(
    db: Database,
    siteId: string,
    row: { id: string; robot_id: number; robot_name: string | null },
    reason: string,
    ipAddress: string | null,
): Promise<void> {
    await db.transaction(async () => {
        // Hanya bila baris masih menunjuk robot ini: sapuan lain, atau robot pengganti, bisa sudah mengubahnya.
        const cleared = await db.execute(
            `update site_operations set registry_robot_id = null, registry_robot_name = null,
                updated_at = now() at time zone 'utc'
             where id = $1 and registry_robot_id = $2`,
            [row.id, row.robot_id],
        );
        if (cleared)
            await recordAudit(db, {
                operatorId: null,
                ipAddress,
                action: 'site.registry_robot.deleted',
                subjectType: 'site',
                subjectId: siteId,
                detail: {
                    operation_id: row.id,
                    robot: row.robot_name,
                    reason,
                },
            });
    });
}

export async function issueRegistryCredential(
    db: Database,
    config: Config,
    siteId: string,
    operationId: string,
    ipAddress: string,
): Promise<{
    registry: string;
    username: string;
    password: string;
    expires_at: string;
}> {
    const current = await db.one(
        robotRowSchema,
        `select id, operation, registry_robot_id as robot_id, registry_robot_name as robot_name, ${held} as held
         from site_operations where id = $1 and site_id = $2`,
        [operationId, siteId],
    );
    if (!current?.held) throw notHeld();
    const { client, host, robotDays } = await registry(db, config);

    // Pemanggilan ulang, misalnya saat pull dijawab 401 di tengah jalan: robot lama dihapus lalu yang baru dibuat,
    // karena Harbor tidak memberi robot sistem izin memutar rahasia robot lain.
    if (current.robot_id !== null) {
        await client.deleteRobot(current.robot_id);
        await forgetRobot(
            db,
            siteId,
            { ...current, robot_id: current.robot_id },
            'diganti',
            ipAddress,
        );
    }

    const robot = await client.createPullRobot(
        robotName(operationId),
        robotDays,
        `Situs ${toAgentId(siteId)}, operasi ${current.operation} ${toAgentId(operationId)}. Dihapus control plane saat operasinya ditutup.`,
    );
    const expiresAt = robot.expiresAt.toISOString().slice(0, 19) + '+00:00';
    const recorded = await db.transaction(async () => {
        const site = await db.one(
            z.object({ revoked: z.boolean() }),
            'select revoked_at is not null as revoked from sites where id = $1 for update',
            [siteId],
        );
        // Operasi bisa ditutup selama robot dibuat. Robot untuk operasi yang tidak lagi dipegang tidak dicatat, dan
        // dihapus sebelum rahasianya diberikan kepada siapa pun.
        const locked = await db.one(
            z.object({ id: z.string() }),
            `select id from site_operations
             where id = $1 and site_id = $2 and ${held} and registry_robot_id is null for update`,
            [operationId, siteId],
        );
        if (!site || site.revoked || !locked) return false;
        await db.execute(
            `update site_operations set registry_robot_id = $2, registry_robot_name = $3,
                updated_at = now() at time zone 'utc'
             where id = $1`,
            [operationId, robot.id, robot.name],
        );
        await recordAudit(db, {
            operatorId: null,
            ipAddress,
            action: 'site.registry_robot.issued',
            subjectType: 'site',
            subjectId: siteId,
            detail: {
                operation_id: operationId,
                operation: current.operation,
                robot: robot.name,
                expires_at: expiresAt,
            },
        });
        return true;
    });
    if (!recorded) {
        await client.deleteRobot(robot.id);
        throw notHeld();
    }
    return {
        registry: host,
        username: robot.name,
        password: robot.secret,
        expires_at: expiresAt,
    };
}

// Menghapus robot milik operasi situs ini yang tidak lagi dipegang agen. Tidak pernah melempar, karena dipanggil dari
// jalur agen dan operator yang tidak boleh gagal hanya karena Harbor sedang tidak menjawab. Situs yang dicabut
// menghapus robot operasi yang masih berjalan juga, karena agennya tidak akan pernah melapor lagi.
export async function releaseClosedRobots(
    db: Database,
    config: Config,
    siteId: string,
    ipAddress: string | null,
    includeRunning = false,
): Promise<void> {
    const rows = await db.rows(
        robotRowSchema,
        `select id, operation, registry_robot_id as robot_id, registry_robot_name as robot_name, ${held} as held
         from site_operations where site_id = $1 and registry_robot_id is not null`,
        [siteId],
    );
    const closed = rows.filter((row) => includeRunning || !row.held);
    if (!closed.length) return;
    try {
        const { client } = await registry(db, config);
        for (const row of closed) {
            if (row.robot_id === null) continue;
            await client.deleteRobot(row.robot_id);
            await forgetRobot(
                db,
                siteId,
                { ...row, robot_id: row.robot_id },
                includeRunning ? 'situs_dicabut' : 'operasi_ditutup',
                ipAddress,
            );
        }
    } catch (error) {
        if (!(error instanceof RegistryUnavailable)) throw error;
        process.stderr.write(
            JSON.stringify({
                event: 'registry-robot-cleanup-deferred',
                site_id: siteId,
                message: error.message,
            }) + '\n',
        );
    }
}
