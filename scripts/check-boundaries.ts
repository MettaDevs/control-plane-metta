import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// Batas yang dijaga, sesuai bagian Susunan repo di AGENTS.md:
//   1. Dari luar sebuah kemampuan (src/platform/<x>/) atau area (src/<area>/), impor hanya pintunya: index.ts, atau
//      index.<audiens>.ts untuk route satu audiens.
//   2. Berkas satu audiens tidak meng-import berkas audiens lain.
//   3. Proses di akar src/ hanya memuat berkas audiensnya sendiri, dihitung atas seluruh rantai impornya, supaya
//      rute konsol tidak pernah ada di proses agen atau portal walaupun lewat perantara.
//   4. Hanya test yang meng-import berkas proses.
const audiences = ['console', 'agent', 'portal'] as const;
type Audience = (typeof audiences)[number];

const root = resolve(process.argv[2] ?? join(import.meta.dir, '..'));
const src = join(root, 'src');
const extension = /\.(ts|tsx|js|mjs|cjs)$/;

function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return files(path);
        return extension.test(entry.name) ? [path] : [];
    });
}

const roles = (path: string) =>
    basename(path).replace(extension, '').split('.').slice(1);
const isTest = (path: string) => roles(path).includes('test');
const isProcess = (path: string) => dirname(path) === src && !isTest(path);

// Nama fitur dibuang lebih dulu, jadi fitur bernama `agent` tetap dibaca dari perannya.
function audienceOf(path: string): Audience | null {
    return audiences.find((audience) => roles(path).includes(audience)) ?? null;
}

function processAudience(path: string): Audience | null {
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

const checked = files(src);
const imports = new Map<string, { path: string; line: number }[]>();
const violations: string[] = [];
for (const file of checked) {
    const text = readFileSync(file, 'utf8');
    const lineOf = (position: number) =>
        text.slice(0, position).split('\n').length;
    const found = ts
        .preProcessFile(text, true, true)
        .importedFiles.flatMap((imported) => {
            const path = resolveImport(file, imported.fileName);
            return path === null ? [] : [{ path, line: lineOf(imported.pos) }];
        });
    imports.set(file, found);
    const ownUnit = unitOf(file);
    const ownAudience = audienceOf(file);
    for (const { path, line } of found) {
        const at = `${shown(file)}:${line} imports ${shown(path)}`;
        const unit = unitOf(path);
        if (unit && unit !== ownUnit && !isDoor(unit, path))
            violations.push(
                `${at}; outside ${shown(unit)}/ import only its index.ts or index.<audience>.ts.`,
            );
        const targetAudience = audienceOf(path);
        if (ownAudience && targetAudience && targetAudience !== ownAudience)
            violations.push(
                `${at}; ${ownAudience} files must not import ${targetAudience} files.`,
            );
        if (isProcess(path) && !isTest(file))
            violations.push(`${at}; only tests may import a process file.`);
    }
}

for (const entry of checked.filter(isProcess)) {
    const allowed = processAudience(entry);
    const seen = new Set<string>([entry]);
    const queue = [entry];
    for (let file = queue.shift(); file; file = queue.shift())
        for (const { path } of imports.get(file) ?? [])
            if (!seen.has(path)) {
                seen.add(path);
                queue.push(path);
            }
    for (const file of seen) {
        const audience = audienceOf(file);
        if (audience && audience !== allowed)
            violations.push(
                `${shown(entry)} loads ${shown(file)}; ${allowed ? `the ${allowed} process loads only ${allowed} files` : 'a process without an audience loads no audience files'}.`,
            );
    }
}

if (violations.length) {
    console.error(violations.join('\n'));
    console.error(`${violations.length} boundary violation(s).`);
    process.exit(1);
}
console.log(`Boundaries hold across ${checked.length} files under src/.`);
