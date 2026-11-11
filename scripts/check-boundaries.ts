import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// Batas yang dijaga, sesuai bagian Susunan repo dan Layar di AGENTS.md:
//   1. Dari luar sebuah kemampuan (src/platform/<x>/) atau area (src/<area>/), impor hanya pintunya: index.ts, atau
//      index.<audiens>.ts untuk route satu audiens. Pengecualiannya src/client.tsx, yang meng-import setiap halaman.
//   2. Berkas satu audiens tidak meng-import berkas audiens lain.
//   3. Proses di akar src/ hanya memuat berkas audiensnya sendiri, dihitung atas seluruh rantai impornya, supaya
//      rute konsol tidak pernah ada di proses agen atau portal walaupun lewat perantara. src/client.tsx adalah entry
//      peramban layar konsol dan src/portal-client.tsx entry peramban layar portal, jadi keduanya dihitung sebagai
//      proses audiensnya. Berkas di rantai itu juga tidak meng-import berkas proses audiens lain, walau hanya tipenya:
//      klien API konsol, yang bertipe router konsol, tidak pernah ikut bundle portal.
//   4. Hanya test yang meng-import berkas proses. Kode peramban boleh meng-import tipenya (`import type`).
//   5. Test hanya ada di test/, di folder yang sama dengan letak kode yang diujinya di src/ atau scripts/. Bantuan test
//      ada di test/support/. Kode di src/ dan scripts/ tidak meng-import apa pun dari test/. Test sebuah package ada
//      di test/ package itu, mengikuti folder src/-nya.
//   6. Kode peramban (kedua entry peramban, src/platform/shell/, dan setiap .tsx) dan kode server tidak saling
//      meng-import. Kode peramban hanya boleh mengambil tipe dari kode server, yang hilang saat dibundel.
//   7. Hanya entry peramban yang meng-import halaman (.page.tsx).
//   8. Package di packages/ tidak meng-import src/.
const audiences = ['console', 'agent', 'portal'] as const;
type Audience = (typeof audiences)[number];

const root = resolve(process.argv[2] ?? join(import.meta.dir, '..'));
const src = join(root, 'src');
const scripts = join(root, 'scripts');
const tests = join(root, 'test');
const packages = join(root, 'packages');
const support = join(tests, 'support') + sep;
const shell = join(src, 'platform', 'shell') + sep;
const clientEntries = new Map<string, Audience>([
    [join(src, 'client.tsx'), 'console'],
    [join(src, 'portal-client.tsx'), 'portal'],
]);
const extension = /\.(ts|tsx|js|mjs|cjs)$/;

function files(directory: string): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === 'node_modules') return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return files(path);
        return extension.test(entry.name) ? [path] : [];
    });
}

const roles = (path: string) =>
    basename(path).replace(extension, '').split('.').slice(1);
const isTest = (path: string) => roles(path).includes('test');
const isProcess = (path: string) => dirname(path) === src && !isTest(path);
const isPage = (path: string) => path.endsWith('.page.tsx');
const isBrowser = (path: string) =>
    clientEntries.has(path) || path.startsWith(shell) || path.endsWith('.tsx');

// Nama fitur dibuang lebih dulu, jadi fitur bernama `agent` tetap dibaca dari perannya.
function audienceOf(path: string): Audience | null {
    return audiences.find((audience) => roles(path).includes(audience)) ?? null;
}

function processAudience(path: string): Audience | null {
    const entry = clientEntries.get(path);
    if (entry) return entry;
    const name = basename(path).replace(extension, '');
    return audiences.find((audience) => audience === name) ?? null;
}

// src/platform/<x>/ dan src/<area>/ masing-masing satu unit dengan pintunya sendiri.
function unitOf(path: string): string | null {
    const [first, second, ...rest] = relative(src, path).split(sep);
    if (first === undefined || first.startsWith('..') || second === undefined)
        return null;
    if (first !== 'platform') return join(src, first) + sep;
    return rest.length ? join(src, first, second) + sep : null;
}

const isDoor = (unit: string, path: string) =>
    dirname(path) + sep === unit &&
    /^index(\.(console|agent|portal))?\.ts$/.test(basename(path));

function resolveImport(file: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const path = resolve(dirname(file), specifier);
    if (existsSync(join(path, 'index.ts'))) return join(path, 'index.ts');
    return path;
}

const shown = (path: string) => relative(root, path).replaceAll(sep, '/');

type Import = { path: string; line: number; typeOnly: boolean };

// Setiap impor berkas lokal beserta barisnya. `import type` dan `export type ... from` ditandai, karena keduanya
// hilang saat dibundel.
function importsOf(file: string): Import[] {
    const text = readFileSync(file, 'utf8');
    const lineOf = (position: number) =>
        text.slice(0, position).split('\n').length;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
    const typeOnly = new Set<string>();
    for (const statement of source.statements) {
        let specifier: ts.Expression | undefined;
        let onlyTypes = false;
        if (ts.isImportDeclaration(statement)) {
            specifier = statement.moduleSpecifier;
            onlyTypes = statement.importClause?.isTypeOnly === true;
        } else if (ts.isExportDeclaration(statement)) {
            specifier = statement.moduleSpecifier;
            onlyTypes = statement.isTypeOnly;
        }
        if (!specifier || !ts.isStringLiteral(specifier)) continue;
        if (onlyTypes)
            typeOnly.add(
                `${lineOf(specifier.getStart(source))}:${specifier.text}`,
            );
    }
    return ts
        .preProcessFile(text, true, true)
        .importedFiles.flatMap((imported) => {
            const path = resolveImport(file, imported.fileName);
            const line = lineOf(imported.pos);
            return path === null
                ? []
                : [
                      {
                          path,
                          line,
                          typeOnly: typeOnly.has(
                              `${line}:${imported.fileName}`,
                          ),
                      },
                  ];
        });
}

const checked = files(src);
const imports = new Map<string, Import[]>();
const violations: string[] = [];

for (const file of [...checked, ...files(scripts)]) {
    if (isTest(file))
        violations.push(
            `${shown(file)}; tests live under test/, in the folder that mirrors the code they test.`,
        );
    for (const { path } of importsOf(file))
        if (path.startsWith(tests + sep))
            violations.push(
                `${shown(file)} imports ${shown(path)}; code under src/ and scripts/ must not import test/.`,
            );
}

// test/scripts/x mencerminkan scripts/x, test/x mencerminkan src/x. Folder test yatim berarti kodenya sudah pindah.
for (const file of files(tests).filter(
    (path) => isTest(path) && !path.startsWith(support),
)) {
    const folder = relative(tests, dirname(file));
    const [first, ...rest] = folder.split(sep);
    const mirrored =
        first === 'scripts' ? join(scripts, ...rest) : join(src, folder);
    if (!existsSync(mirrored))
        violations.push(
            `${shown(file)}; test/${folder.replaceAll(sep, '/')} mirrors no folder. Move the test next to the mirror of the code it tests.`,
        );
}

// packages/<x>/test/y mencerminkan packages/<x>/src/y; packages/<x>/test/support/ berisi bantuan test.
for (const owner of existsSync(packages)
    ? readdirSync(packages, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(packages, entry.name))
    : []) {
    const ownTests = join(owner, 'test');
    for (const file of files(owner)) {
        const inTests = file.startsWith(ownTests + sep);
        if (isTest(file) && !inTests)
            violations.push(
                `${shown(file)}; a package's tests live under its test/, in the folder that mirrors its src/.`,
            );
        if (isTest(file) && inTests) {
            const folder = relative(ownTests, dirname(file));
            if (
                folder.split(sep)[0] !== 'support' &&
                !existsSync(join(owner, 'src', folder))
            )
                violations.push(
                    `${shown(file)}; ${shown(dirname(file))} mirrors no folder of ${shown(join(owner, 'src'))}.`,
                );
        }
        for (const { path, line } of importsOf(file))
            if (path.startsWith(src + sep) || path.startsWith(tests + sep))
                violations.push(
                    `${shown(file)}:${line} imports ${shown(path)}; packages/ must not import src/ or test/.`,
                );
    }
}

for (const file of checked) {
    const found = importsOf(file);
    imports.set(file, found);
    const ownUnit = unitOf(file);
    const ownAudience = audienceOf(file);
    const browser = isBrowser(file);
    for (const { path, line, typeOnly } of found) {
        const at = `${shown(file)}:${line} imports ${shown(path)}`;
        const unit = unitOf(path);
        const routedPage = clientEntries.has(file) && isPage(path);
        if (unit && unit !== ownUnit && !isDoor(unit, path) && !routedPage)
            violations.push(
                `${at}; outside ${shown(unit)}/ import only its index.ts or index.<audience>.ts.`,
            );
        const targetAudience = audienceOf(path);
        if (ownAudience && targetAudience && targetAudience !== ownAudience)
            violations.push(
                `${at}; ${ownAudience} files must not import ${targetAudience} files.`,
            );
        if (isProcess(path) && !isTest(file) && !(browser && typeOnly))
            violations.push(`${at}; only tests may import a process file.`);
        if (isPage(path) && !clientEntries.has(file))
            violations.push(
                `${at}; only src/client.tsx and src/portal-client.tsx import pages, through the generated route tree.`,
            );
        if (!path.startsWith(src + sep)) continue;
        if (browser && !isBrowser(path) && !typeOnly)
            violations.push(
                `${at}; browser code takes only types from server code (import type).`,
            );
        if (!browser && isBrowser(path))
            violations.push(`${at}; server code must not import browser code.`);
    }
}

// Rantai impor setiap proses. Impor tipe tidak ikut dibundel, jadi tidak dihitung.
for (const entry of checked.filter(isProcess)) {
    const allowed = processAudience(entry);
    const seen = new Set<string>([entry]);
    const queue = [entry];
    for (let file = queue.shift(); file; file = queue.shift())
        for (const { path, typeOnly } of imports.get(file) ?? [])
            if (!typeOnly && !seen.has(path)) {
                seen.add(path);
                queue.push(path);
            }
    for (const file of seen) {
        const audience = audienceOf(file);
        if (audience && audience !== allowed)
            violations.push(
                `${shown(entry)} loads ${shown(file)}; ${allowed ? `the ${allowed} process loads only ${allowed} files` : 'a process without an audience loads no audience files'}.`,
            );
        for (const { path } of imports.get(file) ?? []) {
            const other = isProcess(path) ? processAudience(path) : null;
            if (allowed && other && other !== allowed)
                violations.push(
                    `${shown(entry)} loads ${shown(file)}, which imports ${shown(path)}; the ${allowed} process does not load code typed by the ${other} process.`,
                );
        }
    }
}

if (violations.length) {
    console.error(violations.join('\n'));
    console.error(`${violations.length} boundary violation(s).`);
    process.exit(1);
}
console.log(
    `Boundaries hold across ${checked.length} files under src/, the packages under packages/, and the tests under test/.`,
);
