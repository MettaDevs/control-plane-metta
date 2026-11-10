import { describe, expect, test } from 'bun:test';
import { agentRouter } from '../src/agent.ts';
import { consoleRouter } from '../src/console.ts';
import { loadConfig } from '../src/platform/config/index.ts';
import { createApplication } from '../src/platform/http/index.ts';

// /up tidak menyentuh database, jadi alamat database palsu cukup: pool baru tersambung pada query pertama.
const config = loadConfig({
    DB_HOST: '127.0.0.1',
    DB_PORT: '1',
    DB_DATABASE: 'unused',
    DB_USERNAME: 'unused',
    DB_PASSWORD: 'unused',
    APP_KEY: 'base64:' + Buffer.alloc(32, 7).toString('base64'),
});

describe.each([
    ['console', consoleRouter(config)],
    ['agent', agentRouter(config)],
])('%s process', (_, router) => {
    const application = createApplication(config, router);

    test('answers /up without a database', async () => {
        const response = await application.handle(
            new Request('http://localhost/up'),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
        expect(response.headers.get('Cache-Control')).toBe('no-cache, private');
    });

    test('answers 404 for a route it does not serve', async () => {
        const response = await application.handle(
            new Request('http://localhost/nothing-here'),
        );
        expect(response.status).toBe(404);
    });
});

// Proses agen tidak membawa build peramban: URL layar dan berkas build dijawab 404 JSON seperti alamat lain, walau
// folder build ada di sebelahnya.
test('the agent process does not serve screens', async () => {
    const application = createApplication(config, agentRouter(config));
    for (const path of ['/', '/login', '/customers', '/build/client.js']) {
        const response = await application.handle(
            new Request(`http://localhost${path}`, {
                headers: { accept: 'text/html' },
            }),
        );
        expect(response.status).toBe(404);
        expect(response.headers.get('content-type')).toContain(
            'application/json',
        );
    }
});
