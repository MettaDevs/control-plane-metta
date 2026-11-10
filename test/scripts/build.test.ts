import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClient } from '../../scripts/build.ts';
import {
    clientManifestSchema,
    type ClientManifest,
} from '../../src/platform/http/index.ts';

let outdir: string;
let manifest: ClientManifest;

beforeAll(async () => {
    outdir = await mkdtemp(join(tmpdir(), 'console-build-'));
    manifest = await buildClient(outdir);
}, 120_000);
afterAll(() => rm(outdir, { recursive: true, force: true }));

test('the client build writes a manifest of hashed files that all exist', async () => {
    const written = clientManifestSchema.parse(
        await Bun.file(join(outdir, 'manifest.json')).json(),
    );
    expect(written).toEqual(manifest);
    expect(manifest.script).toMatch(/^client-[a-z0-9]{8}\.js$/);
    expect(manifest.styles).toHaveLength(1);
    expect(manifest.styles[0]).toMatch(/^client-[a-z0-9]{8}\.css$/);
    expect(manifest.files).toContain(manifest.script);
    expect(manifest.files).toContain(manifest.styles[0]!);
    for (const file of manifest.files)
        expect(await Bun.file(join(outdir, file)).exists()).toBe(true);
});

test('the stylesheet carries the Shell classes and loads fonts as separate files', async () => {
    const css = await Bun.file(join(outdir, manifest.styles[0]!)).text();
    // Kelas yang hanya dipakai bingkai Shell (app-layout.tsx), jadi `@source` di app.css memang memindai src/.
    expect(css).toContain('.min-w-\\[320px\\]');
    expect(css).not.toContain('url(data:font');
    const fonts = [...css.matchAll(/url\(\/build\/([^)]+\.woff2?)\)/g)].map(
        (match) => match[1]!,
    );
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(manifest.files).toContain(font);
});
