import { mkdir, rm } from 'node:fs/promises';
import {
    basename,
    dirname,
    extname,
    join,
    relative,
    resolve,
    sep,
} from 'node:path';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import type { BunPlugin } from 'bun';
import {
    clientAssetPrefix,
    type ClientManifest,
} from '../src/platform/http/index.ts';

// `bun run build`: proses server ke dist/ (console.js, agent.js, cli.js) dan layar konsol ke dist/client/. Berkas peramban bernama `<nama>-<hash>.<ext>`,
// dan dist/client/manifest.json mencatat entry, stylesheet, dan setiap berkas yang boleh disajikan server.
// Berkas hasil generate (src/client.tsx dan kontrak API) dibuat lebih dulu oleh scripts/generate-client.ts.

const root = resolve(import.meta.dir, '..');
const clientEntry = join(root, 'src', 'client.tsx');
const posix = (path: string) => path.split(sep).join('/');

// Hash isi berkas dengan panjang yang sama dengan `[hash]` Bun.
const contentHash = (bytes: Uint8Array) =>
    Bun.hash(bytes).toString(36).padStart(8, '0').slice(0, 8);

// Font dari `@fontsource` ditulis sebagai berkas sendiri. Bun menyisipkan berkas kecil sebagai data URL ke CSS, dan
// untuk font itu berarti setiap subset bahasa (devanagari, latin-ext, ...) ikut diunduh di kunjungan pertama, sekitar
// 700 KB setelah gzip; sebagai berkas, peramban hanya mengambil subset yang dipakai halamannya.
async function emitFonts(
    css: string,
    base: string,
    outdir: string,
    emitted: Set<string>,
): Promise<string> {
    const replacements = new Map<string, string>();
    for (const match of css.matchAll(
        /url\((['"]?)([^'")]+\.(?:woff2?|ttf|otf))\1\)/g,
    )) {
        const url = match[2]!;
        if (replacements.has(url) || /^(?:[a-z]+:|\/)/i.test(url)) continue;
        const source = resolve(base, url);
        const bytes = new Uint8Array(await Bun.file(source).arrayBuffer());
        const extension = extname(source);
        const name = `${basename(source, extension)}-${contentHash(bytes)}${extension}`;
        await Bun.write(join(outdir, name), bytes);
        emitted.add(name);
        replacements.set(url, `${clientAssetPrefix}${name}`);
    }
    return css.replace(
        /url\((['"]?)([^'")]+\.(?:woff2?|ttf|otf))\1\)/g,
        (whole, _quote: string, url: string) => {
            const replacement = replacements.get(url);
            return replacement ? `url(${replacement})` : whole;
        },
    );
}

// Tailwind v4 dijalankan lewat @tailwindcss/node dan @tailwindcss/oxide, versi yang sama dengan `tailwindcss` di
// package.json. `bun-plugin-tailwind` membawa salinan Tailwind 4.1 sendiri, dan CLI Tailwind tidak menyesuaikan path
// url() milik CSS yang di-import, jadi font @fontsource kehilangan berkasnya.
function tailwind(outdir: string, fonts: Set<string>): BunPlugin {
    return {
        name: 'tailwind',
        setup(build) {
            build.onLoad(
                { filter: /[\\/]src[\\/]platform[\\/]shell[\\/]app\.css$/ },
                async ({ path }) => {
                    const base = dirname(path);
                    const compiler = await compile(
                        await Bun.file(path).text(),
                        {
                            base,
                            shouldRewriteUrls: true,
                            onDependency: () => {},
                        },
                    );
                    const sources = [
                        ...(compiler.root === null
                            ? [{ base, pattern: '**/*', negated: false }]
                            : compiler.root === 'none'
                              ? []
                              : [{ ...compiler.root, negated: false }]),
                        ...compiler.sources,
                    ];
                    const css = compiler.build(new Scanner({ sources }).scan());
                    return {
                        contents: await emitFonts(css, base, outdir, fonts),
                        loader: 'css',
                    };
                },
            );
        },
    };
}

export async function buildClient(
    outdir: string,
    options: { production: boolean } = { production: true },
): Promise<ClientManifest> {
    await rm(outdir, { recursive: true, force: true });
    await mkdir(outdir, { recursive: true });
    const fonts = new Set<string>();
    const result = await Bun.build({
        entrypoints: [clientEntry],
        outdir,
        target: 'browser',
        format: 'esm',
        minify: options.production,
        sourcemap: 'linked',
        naming: {
            entry: '[name]-[hash].[ext]',
            chunk: '[name]-[hash].[ext]',
            asset: '[name]-[hash].[ext]',
        },
        publicPath: clientAssetPrefix,
        // Font yang sudah ditulis emitFonts dirujuk lewat path build-nya sendiri.
        external: [`${clientAssetPrefix}*`],
        define: {
            'process.env.NODE_ENV': JSON.stringify(
                options.production ? 'production' : 'development',
            ),
        },
        plugins: [tailwind(outdir, fonts)],
        throw: false,
    });
    if (!result.success)
        throw new AggregateError(
            result.logs,
            `Build peramban gagal:\n${result.logs.map(String).join('\n')}`,
        );
    const name = (path: string) => posix(relative(outdir, path));
    const script = result.outputs.find(
        (output) => output.kind === 'entry-point',
    );
    if (!script) throw new Error('Build peramban tidak menghasilkan entry.');
    const manifest: ClientManifest = {
        script: name(script.path),
        styles: result.outputs
            .filter((output) => output.path.endsWith('.css'))
            .map((output) => name(output.path)),
        files: [
            ...result.outputs.map((output) => name(output.path)),
            ...fonts,
        ].sort(),
    };
    await Bun.write(
        join(outdir, 'manifest.json'),
        JSON.stringify(manifest, null, 4) + '\n',
    );
    return manifest;
}

export async function buildServer(outdir: string): Promise<void> {
    const result = await Bun.build({
        entrypoints: ['console.ts', 'agent.ts', 'cli.ts'].map((file) =>
            join(root, 'src', file),
        ),
        outdir,
        target: 'bun',
        minify: true,
        throw: false,
    });
    if (!result.success)
        throw new AggregateError(
            result.logs,
            `Build server gagal:\n${result.logs.map(String).join('\n')}`,
        );
}

if (import.meta.main) {
    const dist = join(root, 'dist');
    await rm(dist, { recursive: true, force: true });
    await buildServer(dist);
    const manifest = await buildClient(join(dist, 'client'));
    console.log(
        `dist/console.js, dist/agent.js, dist/cli.js, dan dist/client/ (${manifest.files.length} berkas) selesai dibangun.`,
    );
}
