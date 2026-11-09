import { afterAll, describe, expect, test } from 'bun:test';
import { agentRouter } from '../../../src/agent.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool, Database } from '../../../src/platform/database/index.ts';
import { createApplication } from '../../../src/platform/http/index.ts';
import { signedRequest } from '../../support/agent-client.ts';
import { releaseKeys, signedRelease } from '../../support/release.ts';
import { createEnrolledSite } from '../../support/sites.ts';

// Butuh PostgreSQL yang sudah dimigrasi. CI selalu menyediakannya; di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('release files for agents', () => {
    if (!process.env.DB_HOST) return;
    const keys = releaseKeys();
    const config = loadConfig({
        ...process.env,
        APP_KEY: 'base64:' + Buffer.alloc(32, 15).toString('base64'),
        CONSOLE_RELEASE_TOKEN: 'release-token-for-tests',
        CONSOLE_RELEASE_PUBLIC_KEY_PATH: keys.publicKeyPath,
        CONSOLE_REGISTRY_PROJECT: 'coreerp',
    });
    const agent = createApplication(config, agentRouter(config));
    const pool = createPool(config);
    const db = new Database(pool);
    afterAll(async () => {
        await db.release();
        await agent.close();
        await pool.end();
    });

    test('serves the five files byte for byte, only for the site edition', async () => {
        const site = await createEnrolledSite(db, agent);
        const release = `8.${Math.floor(Math.random() * 1000)}.0`;
        const built = signedRelease(keys.privateKey, { release });
        const registered = await agent.handle(
            new Request('http://localhost/api/releases/v1', {
                method: 'POST',
                headers: { authorization: 'Bearer release-token-for-tests' },
                body: built.form,
            }),
        );
        expect(registered.status).toBe(201);

        const download = (edition: string, file: string) =>
            agent.handle(
                signedRequest({
                    method: 'GET',
                    path: `/api/agent/v1/releases/${edition}/${release}/files/${file}`,
                    keyId: site.agentId,
                    privateKey: site.keys.privateKey,
                }),
            );
        for (const [file, expected] of [
            ['manifest.json', built.files.manifest],
            ['compose.yaml', built.files.compose],
            ['update.sh', built.files.update],
            ['SHA256SUMS', built.files.checksums],
        ] as const) {
            const response = await download('coreerp', file);
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(await response.text()).toBe(expected);
        }
        const signature = await download('coreerp', 'SHA256SUMS.sig');
        expect(
            Buffer.from(await signature.arrayBuffer()).equals(
                Buffer.from(built.files.signature),
            ),
        ).toBe(true);

        for (const [edition, file] of [
            ['other-edition', 'manifest.json'],
            ['coreerp', 'secrets.env'],
            ['coreerp', '..%2Fmanifest.json'],
        ] as const)
            expect((await download(edition, file)).status).toBe(404);
    });
});
