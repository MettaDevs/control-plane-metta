import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    audiences,
    bundles,
    pageFiles,
    readPage,
    staleFiles,
} from '../../scripts/generate-client.ts';

const scratch = await mkdtemp(join(tmpdir(), 'console-pages-'));
afterAll(() => rm(scratch, { recursive: true, force: true }));

test('the committed client entry and API contract match what the generator writes', async () => {
    expect(await staleFiles()).toEqual([]);
});

// Setiap bundle hanya memuat halaman prosesnya sendiri: halaman konsol tidak pernah ada di bundle portal.
test.each(audiences)(
    'the %s route tree imports exactly its own pages, and each import resolves',
    async (audience) => {
        const pages = pageFiles(audience);
        expect(pages.length).toBeGreaterThan(0);
        for (const page of pages)
            expect(page).toEndWith(`.${audience}.page.tsx`);
        const entry = bundles[audience].entry;
        const source = await Bun.file(entry).text();
        const imported = [
            ...source.matchAll(/from '(\.[^']+\.page\.tsx)'/g),
        ].map((match) => Bun.resolveSync(match[1]!, dirname(entry)));
        expect(imported.sort()).toEqual([...pages].sort());
        for (const page of pages.map(readPage))
            // Segmen berupa teks kecil, atau parameter route TanStack seperti `$site`.
            expect(page.path).toMatch(
                /^(\/([a-z0-9-]+|\$[a-z][a-zA-Z0-9]*))+$|^\/$/,
            );
    },
);

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
