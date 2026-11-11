import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consoleRouter } from '../../../src/console.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import {
    clientBuild,
    createApplication,
} from '../../../src/platform/http/index.ts';

// URL layar milik aplikasi peramban, data hanya di bawah /api/. Build peramban di sini manifest buatan dengan berkas
// kecil, karena yang diuji cara server menyajikannya; build sungguhan diuji test/scripts/build.test.ts. Tidak ada yang
// di sini menyentuh database, jadi alamat database palsu cukup.
const config = loadConfig({
    DB_HOST: '127.0.0.1',
    DB_PORT: '1',
    DB_DATABASE: 'unused',
    DB_USERNAME: 'unused',
    DB_PASSWORD: 'unused',
    APP_KEY: 'base64:' + Buffer.alloc(32, 9).toString('base64'),
});
const html = { accept: 'text/html' };

describe('console screens and the API share one server', () => {
    let directory: string;
    let app: ReturnType<typeof createApplication>;
    const get = (path: string, headers: Record<string, string> = {}) =>
        app.handle(new Request(`http://localhost${path}`, { headers }));

    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'console-client-'));
        await Bun.write(join(directory, 'client-abc12345.js'), 'export {};');
        await Bun.write(join(directory, 'client-def67890.css'), 'body{}');
        await Bun.write(join(directory, 'secret.txt'), 'bukan untuk peramban');
        await Bun.write(
            join(directory, 'manifest.json'),
            JSON.stringify({
                script: 'client-abc12345.js',
                styles: ['client-def67890.css'],
                files: ['client-abc12345.js', 'client-def67890.css'],
            }),
        );
        app = createApplication(
            config,
            consoleRouter(config),
            clientBuild(directory),
        );
    });
    afterAll(async () => {
        await app.close();
        await rm(directory, { recursive: true, force: true });
    });

    test('a screen URL answers with the document that loads the build, without a session', async () => {
        for (const path of [
            '/',
            '/login',
            '/login?two_factor=1',
            '/customers',
            '/catalog',
            '/halaman/yang/tidak/ada?q=1',
        ]) {
            const response = await get(path, html);
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe(
                'text/html; charset=utf-8',
            );
            expect(response.headers.get('cache-control')).toBe(
                'no-cache, private',
            );
            expect(response.headers.getSetCookie()).toEqual([]);
            const body = await response.text();
            expect(body).toContain(
                '<script type="module" src="/build/client-abc12345.js"></script>',
            );
            expect(body).toContain(
                '<link rel="stylesheet" href="/build/client-def67890.css">',
            );
            expect(body).toContain('<div id="app"></div>');
        }
    });

    test('built files are served immutable, and only those the manifest lists', async () => {
        const script = await get('/build/client-abc12345.js');
        expect(script.status).toBe(200);
        expect(script.headers.get('cache-control')).toBe(
            'public, max-age=31536000, immutable',
        );
        expect(await script.text()).toBe('export {};');
        for (const path of [
            '/build/secret.txt',
            '/build/manifest.json',
            '/build/client-zzz.js',
            '/build/..%2Fmanifest.json',
        ])
            expect((await get(path)).status).toBe(404);
    });

    test('a path under /api/ never falls back to the document, and its 404 stays JSON', async () => {
        const missing = await get('/api/v1/tidak-ada', html);
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ message: 'Not Found' });
        const bare = await get('/api', html);
        expect(bare.status).toBe(404);
        expect(bare.headers.get('content-type')).toContain('application/json');
        const me = await get('/api/v1/me', html);
        expect(me.status).toBe(401);
        expect(await me.json()).toEqual({ message: 'Unauthenticated.' });
    });

    test('health and SSO stay with the server, and POST /login stays with the API', async () => {
        const up = await get('/up', html);
        expect(await up.json()).toEqual({ status: 'ok' });
        // Tanpa CONSOLE_SSO_* route SSO menjawab 404, bukan dokumen layar.
        const sso = await get('/sso/start', html);
        expect(sso.status).toBe(404);
        expect(sso.headers.get('content-type')).toContain('application/json');
        const form = await app.handle(
            new Request('http://localhost/login', {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                },
                body: 'email=a&password=b',
            }),
        );
        expect(form.status).toBe(415);
    });

    test('a rebuilt manifest is served without restarting the server', async () => {
        await get('/customers', html);
        await Bun.write(join(directory, 'client-new00000.js'), 'export {};');
        await Bun.write(
            join(directory, 'manifest.json'),
            JSON.stringify({
                script: 'client-new00000.js',
                styles: [],
                files: ['client-new00000.js'],
            }),
        );
        const body = await (await get('/customers', html)).text();
        expect(body).toContain('/build/client-new00000.js');
        expect(body).not.toContain('client-abc12345.js');
        expect((await get('/build/client-abc12345.js')).status).toBe(404);
    });

    test('without a build the screens say so instead of failing silently', async () => {
        const empty = await mkdtemp(join(tmpdir(), 'console-client-'));
        const bare = createApplication(
            config,
            consoleRouter(config),
            clientBuild(empty),
        );
        try {
            const response = await bare.handle(
                new Request('http://localhost/customers', { headers: html }),
            );
            expect(response.status).toBe(503);
            expect(await response.text()).toContain('bun run build');
        } finally {
            await bare.close();
            await rm(empty, { recursive: true, force: true });
        }
    });
});
