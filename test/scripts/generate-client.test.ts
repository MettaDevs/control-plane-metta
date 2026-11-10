import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    clientEntry,
    pageFiles,
    readPage,
    staleFiles,
} from '../../scripts/generate-client.ts';

const scratch = await mkdtemp(join(tmpdir(), 'console-pages-'));
afterAll(() => rm(scratch, { recursive: true, force: true }));

test('the committed client entry and API contract match what the generator writes', async () => {
    expect(await staleFiles()).toEqual([]);
});

test('the route tree imports every page, and each import resolves', async () => {
    const pages = pageFiles();
    expect(pages.length).toBeGreaterThan(0);
    const source = await Bun.file(clientEntry).text();
    const imported = [...source.matchAll(/from '(\.[^']+\.page\.tsx)'/g)].map(
        (match) => Bun.resolveSync(match[1]!, dirname(clientEntry)),
    );
    expect(imported.sort()).toEqual([...pages].sort());
    for (const page of pages.map(readPage))
        expect(page.path).toMatch(/^\/[a-z0-9/-]*$/);
});

test('a page must declare its path and layout as literals through definePage', async () => {
    const file = join(scratch, 'broken.page.tsx');
    await Bun.write(file, "export const page = { path: '/x' };\n");
    expect(() => readPage(file)).toThrow('definePage');
    await Bun.write(
        file,
        "const where = '/x';\nexport const page = definePage({ path: where, layout: 'app', title: 'X', component: X });\n",
    );
    expect(() => readPage(file)).toThrow(
        '`path` pada definePage harus teks literal',
    );
    await Bun.write(
        file,
        "export const page = definePage({ path: '/x', layout: 'modal', title: 'X', component: X });\n",
    );
    expect(() => readPage(file)).toThrow('layout harus salah satu dari');
    await Bun.write(
        file,
        "export const page = definePage({ path: '/x', layout: 'app', title: 'X', validateSearch, component: X });\n",
    );
    expect(readPage(file)).toEqual({
        file,
        path: '/x',
        layout: 'app',
        validatesSearch: true,
    });
});
