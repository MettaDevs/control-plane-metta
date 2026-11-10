// Perintah operasional yang dijalankan di dalam container, misalnya `bun dist/cli.js create-operator`.
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadConfig } from './platform/config/index.ts';
import { createPool, Database } from './platform/database/index.ts';
import {
    flushErrorReporting,
    reportError,
    startErrorReporting,
} from './platform/error-reporting/index.ts';
import {
    addRuntimeHost,
    RuntimeHostRejected,
    runtimeHostInputSchema,
} from './environments/index.ts';
import { createOperator } from './platform/operator-identity/index.ts';
import {
    RegistryUnavailable,
    storeSystemRobot,
    systemRobotSchema,
} from './releases/index.ts';

const usage = `Usage:
  bun src/cli.ts create-operator --name <name> --email <email>
    The password is read from stdin, never from an argument, because arguments show up in ps and shell history.
    Example: read -rs PASSWORD && printf '%s' "$PASSWORD" | bun src/cli.ts create-operator --name "..." --email "..."
  bun src/cli.ts set-registry-robot
    Stores the Harbor system robot, encrypted, after Harbor proves it can see the registry project. Reads
    {"name": "...", "secret": "..."} from stdin.
    Example: printf '{"name":"%s","secret":"%s"}' "$REGISTRY_USERNAME" "$REGISTRY_PASSWORD" | bun src/cli.ts set-registry-robot
  bun src/cli.ts add-runtime-host --name <name>
    Registers a server that runs operations-metta environments. Reads the worker's RSA public key (PEM) from stdin
    and prints the host id, which the worker uses as its keyid.
    Example: bun src/cli.ts add-runtime-host --name saas-1 < worker-public.pem`;

// Pemakaian yang salah adalah kesalahan orang yang mengetik, bukan kesalahan program, jadi tidak dikirim ke Sentry.
class UsageError extends Error {}

async function createOperatorCommand(args: string[]): Promise<void> {
    const { values } = parseArgs({
        args,
        options: { name: { type: 'string' }, email: { type: 'string' } },
    });
    if (!values.name || !values.email) throw new UsageError(usage);
    if (process.stdin.isTTY)
        throw new UsageError('Send the password through stdin.\n' + usage);
    const password = (await Bun.stdin.text()).replace(/\r?\n$/, '');
    const config = loadConfig();
    startErrorReporting(config, 'cli');
    const pool = createPool(config);
    const db = new Database(pool);
    try {
        const operator = await createOperator(
            db,
            { name: values.name, email: values.email, password },
            { operatorId: null, ipAddress: null },
        );
        console.log(`created operator ${operator.id} (${operator.email})`);
    } finally {
        await db.release();
        await pool.end();
    }
}

async function setRegistryRobotCommand(): Promise<void> {
    if (process.stdin.isTTY)
        throw new UsageError(`Send the robot through stdin.\n${usage}`);
    const robot = systemRobotSchema.parse(JSON.parse(await Bun.stdin.text()));
    const config = loadConfig();
    startErrorReporting(config, 'cli');
    const pool = createPool(config);
    const db = new Database(pool);
    try {
        await storeSystemRobot(db, config, robot);
        console.log(`stored registry robot ${robot.name}`);
    } finally {
        await db.release();
        await pool.end();
    }
}

async function addRuntimeHostCommand(args: string[]): Promise<void> {
    const { values } = parseArgs({
        args,
        options: { name: { type: 'string' } },
    });
    if (!values.name) throw new UsageError(usage);
    if (process.stdin.isTTY)
        throw new UsageError(`Send the public key through stdin.
${usage}`);
    const input = runtimeHostInputSchema.parse({
        name: values.name,
        public_key: await Bun.stdin.text(),
    });
    const config = loadConfig();
    startErrorReporting(config, 'cli');
    const pool = createPool(config);
    const db = new Database(pool);
    try {
        const host = await addRuntimeHost(db, input);
        console.log(
            `added runtime host ${host.id} (key sha256 ${host.fingerprint})`,
        );
    } finally {
        await db.release();
        await pool.end();
    }
}

const [command, ...rest] = process.argv.slice(2);
try {
    switch (command) {
        case 'create-operator':
            await createOperatorCommand(rest);
            break;
        case 'set-registry-robot':
            await setRegistryRobotCommand();
            break;
        case 'add-runtime-host':
            await addRuntimeHostCommand(rest);
            break;
        default:
            throw new UsageError(usage);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    // Harbor yang menolak robot atau tidak menjawab adalah keadaan server, bukan kesalahan program.
    if (
        !(error instanceof UsageError) &&
        !(error instanceof z.ZodError) &&
        !(error instanceof RegistryUnavailable) &&
        !(error instanceof RuntimeHostRejected)
    )
        reportError(error);
    await flushErrorReporting();
    process.exitCode = 1;
}
