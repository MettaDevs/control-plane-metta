import { afterAll, describe, expect, test } from 'bun:test';
import { agentRouter } from '../../../src/agent.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { releaseKeys, signedRelease } from '../../support/release.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('release registration', () => {
    if (!process.env.DB_HOST) return;
    const keys = releaseKeys();
    const settings = {
        ...process.env,
        APP_KEY: 'base64:' + Buffer.alloc(32, 14).toString('base64'),
        CONSOLE_RELEASE_TOKEN: 'release-token-for-tests',
        CONSOLE_RELEASE_PUBLIC_KEY_PATH: keys.publicKeyPath,
        CONSOLE_REGISTRY_PROJECT: 'coreerp',
    };
    const config = loadConfig(settings);
    const application = createApplication(config, agentRouter(config));
    afterAll(() => application.close());

    const register = (form: FormData, token = 'release-token-for-tests') =>
        application.handle(
            new Request('http://localhost/api/releases/v1', {
                method: 'POST',
                headers: { authorization: `Bearer ${token}` },
                body: form,
            }),
            `192.0.2.${Math.floor(Math.random() * 250) + 1}`,
        );
    const unique = () =>
        `9.${Math.floor(Math.random() * 1000)}.${Math.floor(Math.random() * 1000)}`;

    test('registers a signed release once and accepts the same release again', async () => {
        const release = unique();
        const first = await register(
            signedRelease(keys.privateKey, { release }).form,
        );
        expect(first.status).toBe(201);
        expect(await first.json()).toEqual({ edition: 'coreerp', release });
        const again = await register(
            signedRelease(keys.privateKey, { release }).form,
        );
        expect(again.status).toBe(200);
        const changed = await register(
            signedRelease(keys.privateKey, {
                release,
                compose: 'services: {}\n',
            }).form,
        );
        expect(changed.status).toBe(409);
        expect(await changed.json()).toMatchObject({
            error: 'release_conflict',
        });
    });

    test('refuses a wrong token, a bad signature, a wrong checksum, and an image outside the project', async () => {
        const unauthorized = await register(
            signedRelease(keys.privateKey, { release: unique() }).form,
            'wrong',
        );
        expect(unauthorized.status).toBe(401);
        expect(await unauthorized.json()).toMatchObject({
            error: 'release_token_invalid',
        });
        const other = releaseKeys();
        for (const [form, error] of [
            [
                signedRelease(other.privateKey, { release: unique() }).form,
                'signature_invalid',
            ],
            [
                signedRelease(keys.privateKey, {
                    release: unique(),
                    tamper: 'signature',
                }).form,
                'signature_invalid',
            ],
            [
                signedRelease(keys.privateKey, {
                    release: unique(),
                    tamper: 'checksum',
                }).form,
                'checksums_invalid',
            ],
            [
                signedRelease(keys.privateKey, {
                    release: unique(),
                    project: 'elsewhere',
                }).form,
                'manifest_invalid',
            ],
            [
                signedRelease(keys.privateKey, { release: '1.2' }).form,
                'manifest_invalid',
            ],
        ] as const) {
            const response = await register(form);
            expect(response.status).toBe(422);
            expect(await response.json()).toMatchObject({ error });
        }
        const missing = new FormData();
        missing.set('manifest', new Blob(['{}']));
        expect((await register(missing)).status).toBe(422);
    });

    test('refuses every registration while no token or key is configured', async () => {
        const bare = loadConfig({
            ...settings,
            CONSOLE_RELEASE_TOKEN: undefined,
            CONSOLE_RELEASE_PUBLIC_KEY_PATH: undefined,
        });
        const closed = createApplication(bare, agentRouter(bare));
        try {
            const response = await closed.handle(
                new Request('http://localhost/api/releases/v1', {
                    method: 'POST',
                    headers: { authorization: 'Bearer anything' },
                    body: signedRelease(keys.privateKey, { release: unique() })
                        .form,
                }),
            );
            expect(response.status).toBe(401);
        } finally {
            await closed.close();
        }
    });
});
