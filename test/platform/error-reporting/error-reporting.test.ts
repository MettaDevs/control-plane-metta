import { afterAll, describe, expect, test } from 'bun:test';
import { loadConfig } from '../../../src/platform/config/index.ts';
import {
    flushErrorReporting,
    reportError,
} from '../../../src/platform/error-reporting/index.ts';
import { base, HttpFailure, serve } from '../../../src/platform/http/index.ts';

// Sentry tiruan: server HTTP sungguhan yang menyimpan setiap envelope yang diterimanya, jadi yang diperiksa adalah
// byte yang benar-benar dikirim SDK. Aplikasinya juga dipanggil lewat HTTP sungguhan, karena SDK membungkus
// Bun.serve dan bisa menempelkan header request ke kesalahan yang dikirim.
const envelopes: string[] = [];
const ingest = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
        envelopes.push(await request.text());
        return Response.json({ id: crypto.randomUUID() });
    },
});
const sent = () => envelopes.join('\n');
const port = 41000 + Math.floor(Math.random() * 2000);
const config = loadConfig({
    DB_HOST: '127.0.0.1',
    DB_PORT: '1',
    DB_DATABASE: 'unused',
    DB_USERNAME: 'unused',
    DB_PASSWORD: 'unused',
    APP_KEY: 'base64:' + Buffer.alloc(32, 10).toString('base64'),
    PORT: String(port),
    SENTRY_DSN: `http://public@127.0.0.1:${ingest.port}/42`,
    SENTRY_ENVIRONMENT: 'test',
});
const unique = crypto.randomUUID();
let server: { stop: () => Promise<void> } | undefined;

afterAll(async () => {
    await server?.stop();
    ingest.stop(true);
});

describe('error reporting', () => {
    test('sends nothing before it is started with a DSN', async () => {
        reportError(new Error(`before start ${unique}`));
        await flushErrorReporting(500);
        expect(envelopes).toHaveLength(0);
    });

    test('sends a 500 with its route and without request data', async () => {
        server = serve('test', config, {
            explode: base
                .route({ method: 'POST', path: '/explode' })
                .handler(() => {
                    throw new Error(`boom ${unique}`);
                }),
            refuse: base
                .route({ method: 'POST', path: '/refuse' })
                .handler(() => {
                    throw new HttpFailure(422, {
                        message: `refused ${unique}`,
                    });
                }),
        });
        const call = (path: string) =>
            fetch(`http://127.0.0.1:${port}${path}?token=SECRET_QUERY`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: 'control_plane_session=SECRET_COOKIE',
                    authorization: 'Bearer SECRET_TOKEN',
                    'x-forwarded-for': '203.0.113.77',
                },
                body: JSON.stringify({ password: 'SECRET_BODY' }),
            });

        expect((await call('/refuse')).status).toBe(422);
        const response = await call('/explode');
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ message: 'Server Error' });
        await flushErrorReporting(5000);

        expect(sent()).toContain(`boom ${unique}`);
        expect(sent()).toContain('"http.route":"/explode"');
        expect(sent()).toContain('"process":"test"');
        expect(sent()).not.toContain(`refused ${unique}`);
        for (const secret of [
            'SECRET_QUERY',
            'SECRET_COOKIE',
            'SECRET_TOKEN',
            'SECRET_BODY',
            '203.0.113.77',
        ])
            expect(sent()).not.toContain(secret);
    });
});
