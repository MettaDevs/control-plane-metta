import { expect, test } from 'bun:test';
import { pageFiles, readPage } from '../../../scripts/generate-client.ts';
import {
    homePath,
    navigation,
} from '../../../src/platform/shell/navigation.ts';

// Menu hanya berisi halaman yang sudah ada, supaya operator tidak pernah membuka tautan yang berakhir di "Halaman
// tidak ditemukan".
test('every menu entry and the home page point to an existing page', () => {
    const paths = new Set(
        pageFiles('console').map((file) => readPage(file).path),
    );
    const hrefs = navigation.flatMap((group) => [
        group.href,
        ...group.items.map((item) => item.href),
    ]);
    for (const href of [homePath, ...hrefs]) expect(paths).toContain(href);
});
