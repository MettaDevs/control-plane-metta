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
import { createOperator } from './platform/operator-identity/index.ts';

const usage = `Usage:
  bun src/cli.ts create-operator --name <name> --email <email>
    The password is read from stdin, never from an argument, because arguments show up in ps and shell history.
    Example: read -rs PASSWORD && printf '%s' "$PASSWORD" | bun src/cli.ts create-operator --name "..." --email "..."`;

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

const [command, ...rest] = process.argv.slice(2);
try {
    switch (command) {
        case 'create-operator':
            await createOperatorCommand(rest);
            break;
        default:
            throw new UsageError(usage);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (!(error instanceof UsageError) && !(error instanceof z.ZodError))
        reportError(error);
    await flushErrorReporting();
    process.exitCode = 1;
}
