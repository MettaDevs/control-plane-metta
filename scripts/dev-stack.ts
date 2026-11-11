import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';
import { loadConfig } from '../src/platform/config/index.ts';
import { createPool, Database } from '../src/platform/database/index.ts';
import { addRuntimeHost } from '../src/environments/index.ts';
import { createOperator } from '../src/platform/operator-identity/index.ts';

// `bun run dev:stack`: seluruh alur SaaS di laptop dalam satu perintah. Konsol dan agen dari repo ini, operations dan
// worker dari clone operations-metta di sebelahnya, satu container Postgres untuk database keduanya. Customer yang
// dibuat di konsol disiapkan worker laptop, lalu dibuka di <tenant>.localhost atau <tenant>.<kind>.localhost.
// Aman diulang: database, operator, dan host runtime yang sudah ada dipakai lagi.

const root = resolve(import.meta.dir, '..');
const ports = { console: 8100, agent: 8101, operations: 8102 };
const container = 'metta-dev-db';
const database = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '55433',
    DB_USERNAME: 'dev',
    DB_PASSWORD: 'dev-only-not-a-secret',
};
// Kunci dan APP_KEY disimpan di luar repo, supaya setiap worktree memakai host runtime yang sama di database yang sama.
const stateDir = join(homedir(), '.metta-dev');

function findOperations(): string {
    if (process.env.OPERATIONS_DIR) return resolve(process.env.OPERATIONS_DIR);
    // Dari clone utama maupun dari .worktrees/<nama>, clone operations-metta adalah saudara salah satu leluhur.
    for (let dir = root; dirname(dir) !== dir; dir = dirname(dir)) {
        const candidate = join(dirname(dir), 'operations-metta');
        if (existsSync(join(candidate, 'src', 'worker.ts'))) return candidate;
    }
    throw new Error(
        'Clone operations-metta tidak ditemukan di sebelah repo ini. Isi OPERATIONS_DIR dengan foldernya.',
    );
}

function docker(args: string[]): { ok: boolean; out: string } {
    const result = Bun.spawnSync(['docker', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        ok: result.exitCode === 0,
        out: (result.stdout.toString() + result.stderr.toString()).trim(),
    };
}

function startDatabase(): void {
    const state = docker(['inspect', '-f', '{{.State.Running}}', container]);
    if (state.ok && state.out === 'true') return;
    const started = state.ok
        ? docker(['start', container])
        : docker([
              'run',
              '-d',
              '--name',
              container,
              '-e',
              `POSTGRES_USER=${database.DB_USERNAME}`,
              '-e',
              `POSTGRES_PASSWORD=${database.DB_PASSWORD}`,
              '-v',
              `${container}:/var/lib/postgresql/data`,
              '-p',
              `127.0.0.1:${database.DB_PORT}:5432`,
              'postgres:17',
          ]);
    if (!started.ok)
        throw new Error(
            `Container ${container} gagal dinyalakan: ${started.out}`,
        );
    console.log(`[stack] container ${container} dinyalakan`);
}

async function createDatabases(names: string[]): Promise<void> {
    const sql = postgres({
        host: database.DB_HOST,
        port: Number(database.DB_PORT),
        database: 'postgres',
        username: database.DB_USERNAME,
        password: database.DB_PASSWORD,
        max: 1,
        connect_timeout: 2,
        onnotice: () => {},
    });
    try {
        for (let attempt = 1; ; attempt++) {
            try {
                await sql`select 1`;
                break;
            } catch (error) {
                if (attempt >= 30) throw error;
                await Bun.sleep(1000);
            }
        }
        for (const name of names) {
            const [exists] =
                await sql`select 1 from pg_database where datname = ${name}`;
            if (!exists) await sql.unsafe(`create database "${name}"`);
        }
    } finally {
        await sql.end();
    }
}

function run(name: string, command: string[], cwd: string, env: Env): void {
    const result = Bun.spawnSync(command, {
        cwd,
        env: { ...process.env, ...env },
        stdout: 'inherit',
        stderr: 'inherit',
    });
    if (result.exitCode !== 0) throw new Error(`${name} gagal.`);
}

type Env = Record<string, string>;

function readState(): { consoleKey: string; operationsKey: string } {
    mkdirSync(stateDir, { recursive: true });
    const path = join(stateDir, 'app-keys.json');
    if (!existsSync(path)) {
        const key = () => `base64:${randomBytes(32).toString('base64')}`;
        writeFileSync(
            path,
            JSON.stringify({ consoleKey: key(), operationsKey: key() }),
            { mode: 0o600 },
        );
    }
    return z
        .object({ consoleKey: z.string(), operationsKey: z.string() })
        .parse(JSON.parse(readFileSync(path, 'utf8')));
}

function workerKey(): { privatePath: string; publicKey: string } {
    const privatePath = join(stateDir, 'worker.pem');
    const publicPath = join(stateDir, 'worker.pub');
    if (!existsSync(privatePath)) {
        const pair = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
        writeFileSync(publicPath, pair.publicKey);
    }
    return { privatePath, publicKey: readFileSync(publicPath, 'utf8') };
}

// Operator dev dan host runtime laptop. Host dicari lewat kunci publiknya, bukan namanya, supaya kunci baru (folder
// ~/.metta-dev dihapus) menjadi host baru, bukan host lama yang tanda tangannya tidak lagi cocok.
async function prepareControlPlane(
    env: Env,
    publicKey: string,
): Promise<string> {
    const operator = z
        .object({ name: z.string(), email: z.string(), password: z.string() })
        .parse(
            JSON.parse(
                readFileSync(join(root, 'dev', 'operator.json'), 'utf8'),
            ),
        );
    const pool = createPool(loadConfig(env));
    const db = new Database(pool);
    try {
        const existing = await db.one(
            z.object({ id: z.string() }),
            'select id from operators where lower(email) = lower($1)',
            [operator.email],
        );
        if (!existing)
            await createOperator(db, operator, {
                operatorId: null,
                ipAddress: null,
            });
        const host = await db.one(
            z.object({ id: z.string() }),
            'select id from runtime_hosts where public_key = $1 and revoked_at is null',
            [publicKey],
        );
        if (host) return host.id;
        const added = await addRuntimeHost(db, {
            name: `laptop-${Bun.randomUUIDv7().slice(-8)}`,
            public_key: publicKey,
        });
        console.log(`[stack] host runtime laptop terdaftar (${added.id})`);
        return added.id;
    } finally {
        await db.release();
        await pool.end();
    }
}

const operationsDir = findOperations();
startDatabase();
await createDatabases(['control_plane_dev', 'operations_dev']);
const state = readState();
const key = workerKey();

const consoleEnv: Env = {
    ...database,
    DB_DATABASE: 'control_plane_dev',
    APP_KEY: state.consoleKey,
    SESSION_SECURE_COOKIE: 'false',
};
const operationsEnv: Env = {
    ...database,
    DB_DATABASE: 'operations_dev',
    DB_POOL_SIZE: '3',
    APP_KEY: state.operationsKey,
    BASE_DOMAIN: 'localhost',
    SESSION_BACKEND: 'database',
};

run('Migration control plane', ['bun', 'src/migrate.ts'], root, consoleEnv);
run(
    'Migration operations',
    ['bun', 'src/migrate.ts'],
    operationsDir,
    operationsEnv,
);
const hostId = await prepareControlPlane(consoleEnv, key.publicKey);

const processes = [
    {
        name: 'console',
        cwd: root,
        command: ['bun', 'scripts/dev.ts'],
        env: { ...consoleEnv, PORT: String(ports.console) },
    },
    {
        name: 'agent',
        cwd: root,
        command: ['bun', '--watch', 'src/agent.ts'],
        env: { ...consoleEnv, PORT: String(ports.agent) },
    },
    {
        name: 'operations',
        cwd: operationsDir,
        command: ['bun', 'scripts/dev.ts'],
        env: { ...operationsEnv, PORT: String(ports.operations) },
    },
    {
        name: 'worker',
        cwd: operationsDir,
        command: ['bun', '--watch', 'src/worker.ts'],
        env: {
            ...operationsEnv,
            CONTROL_PLANE_URL: `http://127.0.0.1:${String(ports.agent)}`,
            WORKER_HOST_ID: hostId,
            WORKER_PRIVATE_KEY_PATH: key.privatePath,
            WORKER_POLL_SECONDS: '2',
            WORKER_REPORT_SECONDS: '60',
            OPERATIONS_RELEASE: 'laptop',
        },
    },
];

async function prefix(
    name: string,
    stream: ReadableStream<Uint8Array>,
): Promise<void> {
    const decoder = new TextDecoder();
    let buffered = '';
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) console.log(`[${name}] ${line}`);
    }
    if (buffered) console.log(`[${name}] ${buffered}`);
}

// .env di folder kerja setiap proses tetap terbaca Bun, tetapi nilai yang dikirim di sini menimpanya.
const children = processes.map((entry) => {
    const child = Bun.spawn(entry.command, {
        cwd: entry.cwd,
        env: { ...process.env, ...entry.env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    void prefix(entry.name, child.stdout);
    void prefix(entry.name, child.stderr);
    return { ...entry, child };
});

console.log(`[stack] konsol      http://localhost:${String(ports.console)}  (login dari dev/operator.json)
[stack] klinik      http://<tenant>.localhost:${String(ports.operations)}, demo dan sandbox di http://<tenant>.<jenis>.localhost:${String(ports.operations)}
[stack] Ctrl+C menghentikan semuanya.`);

// Konsol dan operations menyalakan anak sendiri (`bun --watch`). Di Windows kill() hanya menghentikan prosesnya,
// sehingga anaknya tertinggal memegang port; taskkill /T menghentikan seluruh pohonnya.
let stopping = false;
const stop = () => {
    stopping = true;
    for (const { child } of children)
        if (process.platform === 'win32')
            Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(child.pid)], {
                stdout: 'ignore',
                stderr: 'ignore',
            });
        else child.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Satu proses yang berhenti sendiri menghentikan semuanya, supaya alur yang setengah hidup tidak terlihat sehat.
const first = await Promise.race(
    children.map(async ({ name, child }) => ({
        name,
        code: await child.exited,
    })),
);
if (!stopping) {
    console.error(
        `[stack] ${first.name} berhenti (kode ${String(first.code)}); semua dihentikan.`,
    );
    stop();
    process.exitCode = 1;
}
await Promise.all(children.map(({ child }) => child.exited));
