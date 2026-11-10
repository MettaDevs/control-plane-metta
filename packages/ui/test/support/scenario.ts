import { join } from 'node:path';

// `bun test` memuat semua berkas test dalam satu proses dengan satu cache module. DOM yang dipasang satu berkas
// akan terbawa ke berkas lain, dan pustaka yang sudah dimuat tanpa DOM tidak dimuat ulang. Karena itu skenario
// DOM berjalan di proses Bun baru, seperti di CoreERP setiap skrip test berjalan di proses Node sendiri.
//
// DOM dipasang lewat `--preload`, bukan impor pertama skenario: Bun mengevaluasi dependency CommonJS seperti
// `react-dom/client` sebelum isi module ESM di sebelahnya, sehingga React DOM akan mengira tidak ada DOM.
export function runScenario(name: string): string {
    const result = Bun.spawnSync({
        cmd: [
            process.execPath,
            '--preload',
            join(import.meta.dir, 'dom.ts'),
            join(import.meta.dir, `${name}.scenario.ts`),
        ],
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    if (result.exitCode !== 0)
        throw new Error(
            `Scenario ${name} exited with ${result.exitCode}:\n${output}`,
        );
    return output;
}
