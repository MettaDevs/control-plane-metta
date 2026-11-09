import { z } from 'zod';
import { recordAudit } from '../../platform/audit/index.ts';
import type { Config } from '../../platform/config/index.ts';
import type { Database } from '../../platform/database/index.ts';
import { SecretBox } from '../../platform/secret-box/index.ts';
import { readSecretSetting, storeSecretSetting } from '../../settings/index.ts';
import { HarborClient, RegistryUnavailable } from './harbor.ts';

const robotKey = 'registry.robot';
const robotSchema = z.object({
    name: z.string().min(1),
    secret: z.string().min(1),
});
export type SystemRobot = z.infer<typeof robotSchema>;

export type Registry = {
    client: HarborClient;
    host: string;
    robotDays: number;
};

function settings(config: Config) {
    const {
        CONSOLE_REGISTRY_HOST,
        CONSOLE_REGISTRY_API_URL,
        CONSOLE_REGISTRY_PROJECT,
    } = config;
    if (
        !CONSOLE_REGISTRY_HOST ||
        !CONSOLE_REGISTRY_API_URL ||
        !CONSOLE_REGISTRY_PROJECT
    )
        throw new RegistryUnavailable(
            'Registry belum disetel (CONSOLE_REGISTRY_HOST, CONSOLE_REGISTRY_API_URL, CONSOLE_REGISTRY_PROJECT).',
        );
    return {
        host: CONSOLE_REGISTRY_HOST,
        apiUrl: CONSOLE_REGISTRY_API_URL,
        project: CONSOLE_REGISTRY_PROJECT,
    };
}

// Klien Harbor dengan robot sistem yang tersimpan. Belum disetel berarti RegistryUnavailable, sama dengan Harbor
// yang tidak menjawab.
export async function registry(
    db: Database,
    config: Config,
): Promise<Registry> {
    const { host, apiUrl, project } = settings(config);
    const robot = await readSecretSetting(
        db,
        new SecretBox(config.key, 'console-settings'),
        robotKey,
        robotSchema,
    );
    if (!robot)
        throw new RegistryUnavailable(
            'Robot sistem Harbor belum disimpan (cli.ts set-registry-robot).',
        );
    return {
        client: new HarborClient({ apiUrl, project, robot }),
        host,
        robotDays: config.CONSOLE_REGISTRY_ROBOT_DAYS,
    };
}

// Robot sistem disimpan hanya setelah Harbor membuktikan kredensialnya bisa melihat project registry.
export async function storeSystemRobot(
    db: Database,
    config: Config,
    robot: SystemRobot,
): Promise<void> {
    const { apiUrl, project } = settings(config);
    await new HarborClient({ apiUrl, project, robot }).verifyRobot();
    await db.transaction(async () => {
        await storeSecretSetting(
            db,
            new SecretBox(config.key, 'console-settings'),
            robotKey,
            robotSchema.parse(robot),
            null,
        );
        await recordAudit(db, {
            operatorId: null,
            ipAddress: null,
            action: 'console.registry_robot.stored',
            subjectType: 'console_setting',
            subjectId: robotKey,
            detail: { robot: robot.name },
        });
    });
}

export { robotSchema as systemRobotSchema };
