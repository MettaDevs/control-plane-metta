import { watch } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { buildClient, clientEntries } from './build.ts';

// `bun run dev`: proses konsol dari src/console.ts dengan `bun --watch`, yang menyalakan ulang server bila kode server
// berubah, dan build peramban ke dist/client/ yang diulang setiap kali berkas di src/ atau packages/ui/src/ berubah.
// `bun run dev:portal` sama untuk proses portal (src/portal.ts) dan build peramban portal ke dist/portal-client/.
// Server membaca manifest yang baru tanpa dinyalakan ulang; muat ulang halaman di peramban untuk melihat hasilnya.

const root = resolve(import.meta.dir, '..');
const target = process.argv[2] === 'portal' ? 'portal' : 'console';
const outdir = join(
    root,
    'dist',
    target === 'portal' ? 'portal-client' : 'client',
);
const shell = join(root, 'src', 'platform', 'shell');
const generated = new Set([
    clientEntries.console,
    clientEntries.portal,
    join(shell, 'api-contract.generated.json'),
    join(shell, 'api-contract.portal.generated.json'),
]);

let running = false;
let again = false;

async function rebuild(): Promise<void> {
    if (running) {
        again = true;
        return;
    }
    running = true;
    const started = performance.now();
    try {
        // Proses terpisah, karena modul router yang sudah di-import proses ini tidak ikut berubah.
        const generate = Bun.spawnSync(['bun', 'scripts/generate-client.ts'], {
            cwd: root,
            stdout: 'ignore',
            stderr: 'inherit',
        });
        if (generate.exitCode !== 0)
            throw new Error('scripts/generate-client.ts gagal.');
        await buildClient(clientEntries[target], outdir, {
            production: false,
        });
        console.log(
            `[dev] build peramban selesai dalam ${Math.round(performance.now() - started)} ms`,
        );
    } catch (error) {
        console.error(
            `[dev] ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
        running = false;
        if (again) {
            again = false;
            void rebuild();
        }
    }
}

await rebuild();

let timer: Timer | undefined;
for (const folder of ['src', join('packages', 'ui', 'src')])
    watch(join(root, folder), { recursive: true }, (_event, file) => {
        if (!file) return;
        const path = join(root, folder, file.toString());
        if (generated.has(path) || path.split(sep).includes('node_modules'))
            return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            console.log(`[dev] ${relative(root, path)} berubah`);
            void rebuild();
        }, 150);
    });

const server = Bun.spawn(['bun', '--watch', `src/${target}.ts`], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit'],
});
process.on('SIGINT', () => {
    server.kill();
    process.exit(0);
});
await server.exited;
