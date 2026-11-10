import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Pengganti check-exports CoreERP. Di sana paket dibangun ke dist; di sini exports menunjuk langsung ke src, dan
// komponen .ts butuh baris exports sendiri karena pola `./*` hanya menunjuk berkas .tsx.
const source = join(import.meta.dir, '..', 'src');
const resolve = (path: string) =>
    Bun.resolveSync(`@control-plane-metta/ui/${path}`, import.meta.dir);

test('every component file is importable as @control-plane-metta/ui/<component>', () => {
    const components = readdirSync(join(source, 'components')).filter((file) =>
        /\.tsx?$/.test(file),
    );
    expect(components.length).toBeGreaterThan(0);
    for (const file of components)
        expect(resolve(file.replace(/\.tsx?$/, ''))).toBe(
            join(source, 'components', file),
        );
});

test('the theme, the class helper, and the stylesheet keep their own entry points', () => {
    expect(resolve('theme')).toBe(join(source, 'theme.ts'));
    expect(resolve('utils')).toBe(join(source, 'utils.ts'));
    expect(resolve('styles.css')).toBe(join(source, 'styles.css'));
});
