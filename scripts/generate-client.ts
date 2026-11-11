import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { type AnyContractRouter, minifyContractRouter } from '@orpc/contract';
import * as prettier from 'prettier';
import ts from 'typescript';
import { consoleRouter } from '../src/console.ts';
import { loadConfig } from '../src/platform/config/index.ts';
import { portalRouter } from '../src/portal.ts';

// Berkas yang diturunkan dari kode dan di-commit, supaya TypeScript mengenalnya. Dua untuk setiap proses yang menyajikan
// layar, yaitu konsol dan portal:
//
// - Entry peramban: `src/client.tsx` untuk konsol, `src/portal-client.tsx` untuk portal. Ia merakit route tree TanStack
//   Router dari setiap `.<proses>.page.tsx` di src/, jadi halaman baru cukup ditulis di folder fiturnya tanpa
//   didaftarkan di mana pun. Hanya kedua berkas ini yang boleh meng-import halaman, dan check:boundaries menjaganya.
// - Bentuk route setiap procedure oRPC proses itu (method, path, struktur input dan output) yang dibutuhkan
//   OpenAPILink di peramban, tanpa kode server: `src/platform/shell/api-contract.generated.json` untuk konsol dan
//   `src/platform/shell/api-contract.portal.generated.json` untuk portal.
//
// `bun run build` dan `bun run dev` menulis semuanya. `--check` hanya membandingkan, dan CI memakainya.

const root = resolve(import.meta.dir, '..');
const shell = join(root, 'src', 'platform', 'shell');
export const audiences = ['console', 'portal'] as const;
export type Audience = (typeof audiences)[number];

// Bentuk route tidak bergantung pada setelan, jadi router dirakit dari setelan pengisi tanpa database, kunci, maupun
// penyedia SSO sungguhan. Tidak ada yang ditandatangani atau disambungkan dengannya.
function shapeOnlyConfig() {
    return loadConfig({
        DB_HOST: 'unused',
        DB_PORT: '1',
        DB_DATABASE: 'unused',
        DB_USERNAME: 'unused',
        DB_PASSWORD: 'unused',
        APP_KEY: 'base64:' + Buffer.alloc(32).toString('base64'),
        PORTAL_URL: 'https://portal.example.com',
        PORTAL_SSO_ISSUER: 'https://sso.example.com',
        PORTAL_SSO_CLIENT_ID: 'unused',
        PORTAL_SSO_CLIENT_SECRET: 'unused',
    });
}

// Setiap bundle peramban: entry-nya, bentuk route prosesnya, pintu bingkai layarnya, dan apakah `/` dialihkan bingkai
// (konsol) atau dimiliki sebuah halaman (portal).
export const bundles: Record<
    Audience,
    {
        entry: string;
        contract: string;
        door: string;
        indexRoute: boolean;
        router: () => AnyContractRouter;
    }
> = {
    console: {
        entry: join(root, 'src', 'client.tsx'),
        contract: join(shell, 'api-contract.generated.json'),
        door: './platform/shell/index.ts',
        indexRoute: true,
        router: () => consoleRouter(shapeOnlyConfig()),
    },
    portal: {
        entry: join(root, 'src', 'portal-client.tsx'),
        contract: join(shell, 'api-contract.portal.generated.json'),
        door: './platform/shell/index.portal.ts',
        indexRoute: false,
        router: () => {
            const config = shapeOnlyConfig();
            return portalRouter(config, config.portal!);
        },
    },
};
export const clientEntry = bundles.console.entry;
const layouts = ['app', 'auth'] as const;
type Layout = (typeof layouts)[number];
export type PageFile = {
    file: string;
    path: string;
    layout: Layout;
    validatesSearch: boolean;
};

const posix = (path: string) => path.split(sep).join('/');

// Halaman satu proses: `.console.page.tsx` hanya masuk bundle konsol, `.portal.page.tsx` hanya bundle portal. Halaman
// tanpa salah satunya ditolak, supaya tidak ada halaman yang diam-diam tidak masuk bundle mana pun.
export function pageFiles(audience: Audience): string[] {
    const all = [...new Bun.Glob('src/**/*.page.tsx').scanSync({ cwd: root })];
    const orphan = all.find(
        (file) =>
            !audiences.some((other) => file.endsWith(`.${other}.page.tsx`)),
    );
    if (orphan)
        throw new Error(
            `${posix(orphan)}: halaman harus bernama .console.page.tsx atau .portal.page.tsx.`,
        );
    return all
        .filter((file) => file.endsWith(`.${audience}.page.tsx`))
        .map((file) => join(root, file))
        .sort((left, right) =>
            posix(relative(root, left)).localeCompare(
                posix(relative(root, right)),
            ),
        );
}

// Bentuk yang dibaca dari setiap halaman: `export const page = definePage({ path: '...', layout: '...', ... })`, dengan
// path dan layout sebagai teks literal supaya route tree bisa dirakit tanpa menjalankan kode halaman.
export function readPage(file: string): PageFile {
    const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    const shown = posix(relative(root, file));
    for (const statement of source.statements) {
        if (
            !ts.isVariableStatement(statement) ||
            !statement.modifiers?.some(
                (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            )
        )
            continue;
        for (const declaration of statement.declarationList.declarations) {
            if (
                !ts.isIdentifier(declaration.name) ||
                declaration.name.text !== 'page'
            )
                continue;
            const call = declaration.initializer;
            const options =
                call && ts.isCallExpression(call) && call.arguments[0];
            if (
                !call ||
                !ts.isCallExpression(call) ||
                call.expression.getText(source) !== 'definePage' ||
                !options ||
                !ts.isObjectLiteralExpression(options)
            )
                throw new Error(
                    `${shown}: \`page\` harus berupa definePage({ ... }).`,
                );
            const property = (name: string) =>
                options.properties.find(
                    (item): item is ts.PropertyAssignment =>
                        ts.isPropertyAssignment(item) &&
                        item.name.getText(source) === name,
                );
            const literal = (name: string) => {
                const value = property(name)?.initializer;
                if (!value || !ts.isStringLiteral(value))
                    throw new Error(
                        `${shown}: \`${name}\` pada definePage harus teks literal.`,
                    );
                return value.text;
            };
            const layout = literal('layout');
            if (!layouts.includes(layout as Layout))
                throw new Error(
                    `${shown}: layout harus salah satu dari ${layouts.join(', ')}.`,
                );
            const validatesSearch = options.properties.some(
                (item) =>
                    (ts.isPropertyAssignment(item) ||
                        ts.isShorthandPropertyAssignment(item)) &&
                    item.name.getText(source) === 'validateSearch',
            );
            return {
                file,
                path: literal('path'),
                layout: layout as Layout,
                validatesSearch,
            };
        }
    }
    throw new Error(
        `${shown}: berkas .page.tsx wajib meng-export \`page\` dari definePage.`,
    );
}

// Nama impor dari path berkas, jadi dua halaman bernama sama di folder berbeda tidak bertabrakan.
function importName(file: string): string {
    const words = posix(relative(root, file))
        .replace(/^src\//, '')
        .replace(/(\.(console|portal))?\.page\.tsx$/, '')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
    return (
        words
            .map((word, index) =>
                index === 0
                    ? word.toLowerCase()
                    : word[0]!.toUpperCase() + word.slice(1),
            )
            .join('') + 'Page'
    );
}

function importPath(file: string): string {
    const path = posix(relative(join(root, 'src'), file));
    return path.startsWith('.') ? path : `./${path}`;
}

function clientSource(audience: Audience, pages: PageFile[]): string {
    const bundle = bundles[audience];
    const index = bundle.indexRoute ? 'indexRoute,' : '';
    const seen = new Map<string, string>();
    for (const page of pages) {
        const other = seen.get(page.path);
        if (other)
            throw new Error(
                `Dua halaman memakai path ${page.path}: ${other} dan ${posix(relative(root, page.file))}.`,
            );
        seen.set(page.path, posix(relative(root, page.file)));
    }
    const parents = { app: 'appLayoutRoute', auth: 'authLayoutRoute' };
    // Setiap route satu konstanta sendiri. createRoute yang ditulis langsung di dalam addChildren([...]) kehilangan
    // tipenya di TypeScript, dan route tree yang tidak bertipe tidak memeriksa path maupun search params.
    const route = (page: PageFile) => {
        const name = importName(page.file);
        const options = [
            `getParentRoute: () => ${parents[page.layout]}`,
            `path: ${name}.path`,
            `component: ${name}.component`,
            ...(page.validatesSearch
                ? [`validateSearch: ${name}.validateSearch`]
                : []),
            `staticData: { title: ${name}.title }`,
        ];
        return `const ${name.replace(/Page$/, 'Route')} = createRoute({ ${options.join(', ')} });`;
    };
    const children = (layout: Layout) =>
        pages
            .filter((page) => page.layout === layout)
            .map((page) => importName(page.file).replace(/Page$/, 'Route'))
            .join(', ');
    return `// Dibuat \`bun scripts/generate-client.ts\` dari setiap berkas \`.${audience}.page.tsx\`; jangan disunting tangan.
// \`bun run build\` dan \`bun run dev\` menulis ulang berkas ini, dan CI menolak berkas yang tidak mutakhir.
import { createRoute, createRouter } from '@tanstack/react-router';
${pages.map((page) => `import { page as ${importName(page.file)} } from '${importPath(page.file)}';`).join('\n')}
import {
    appLayoutRoute,
    authLayoutRoute,
    ${index}
    rootRoute,
    routerOptions,
    startClient,
} from '${bundle.door}';

${pages.map(route).join('\n\n')}

const routeTree = rootRoute.addChildren([
    ${index}
    appLayoutRoute.addChildren([${children('app')}]),
    authLayoutRoute.addChildren([${children('auth')}]),
]);

const router = createRouter({ ...routerOptions, routeTree });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

startClient(router);
`;
}

async function format(source: string, file: string): Promise<string> {
    const options = await prettier.resolveConfig(file);
    return prettier.format(source, { ...options, filepath: file });
}

export async function generatedFiles(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    for (const audience of audiences) {
        const { entry, contract, router } = bundles[audience];
        const pages = pageFiles(audience).map(readPage);
        files.set(entry, await format(clientSource(audience, pages), entry));
        files.set(
            contract,
            await format(
                JSON.stringify(minifyContractRouter(router())),
                contract,
            ),
        );
    }
    return files;
}

// Berkas yang isinya berbeda dari hasil generate. Kosong berarti mutakhir.
export async function staleFiles(): Promise<string[]> {
    const stale: string[] = [];
    for (const [file, content] of await generatedFiles()) {
        const current = Bun.file(file);
        if (!(await current.exists()) || (await current.text()) !== content)
            stale.push(posix(relative(root, file)));
    }
    return stale;
}

export async function writeGeneratedFiles(): Promise<void> {
    for (const [file, content] of await generatedFiles()) {
        const current = Bun.file(file);
        if (!(await current.exists()) || (await current.text()) !== content)
            await Bun.write(file, content);
    }
}

if (import.meta.main) {
    if (process.argv.includes('--check')) {
        const stale = await staleFiles();
        if (stale.length) {
            console.error(
                `Berkas hasil generate tidak mutakhir: ${stale.join(', ')}. Jalankan \`bun scripts/generate-client.ts\` lalu commit hasilnya.`,
            );
            process.exit(1);
        }
        console.log('Berkas hasil generate mutakhir.');
    } else {
        await writeGeneratedFiles();
        console.log(
            'src/client.tsx, src/portal-client.tsx, dan kontrak API layar ditulis ulang.',
        );
    }
}
