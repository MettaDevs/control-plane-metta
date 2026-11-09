import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    OidcProvider,
    pkceChallenge,
    SsoFailure,
} from '../../../../src/platform/operator-identity/sso/oidc.ts';
import { OidcStub } from '../../../support/oidc-provider.ts';

describe('oidc provider', () => {
    let stub: OidcStub;
    let provider: OidcProvider;
    const ceremony = {
        state: 'state-1',
        nonce: 'nonce-1',
        verifier: 'v'.repeat(43),
    };

    beforeAll(async () => {
        stub = await OidcStub.start();
        provider = new OidcProvider(stub.settings);
    });
    afterAll(() => stub.stop());

    const reason = (promise: Promise<unknown>) =>
        promise.then(
            () => 'accepted',
            (error) =>
                error instanceof SsoFailure ? error.reason : String(error),
        );
    const exchange = async (
        claims: Record<string, unknown>,
        verifier = ceremony.verifier,
    ) => {
        const url = await provider.authorizationUrl(ceremony);
        return provider.exchangeCode(
            stub.grant(url, claims),
            verifier,
            ceremony.nonce,
            Date.now(),
        );
    };

    test('builds an authorization code request with PKCE S256', async () => {
        const url = new URL(await provider.authorizationUrl(ceremony));
        expect(url.origin + url.pathname).toBe(`${stub.issuer}/authorize`);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            response_type: 'code',
            client_id: stub.clientId,
            redirect_uri: stub.redirectUri,
            scope: 'openid profile email',
            state: 'state-1',
            nonce: 'nonce-1',
            code_challenge: await pkceChallenge(ceremony.verifier),
            code_challenge_method: 'S256',
        });
    });

    test('accepts a signed ID token, with or without the nonce', async () => {
        expect((await exchange(stub.idClaims())).sub).toBe('subject-1');
        expect((await exchange(stub.idClaims({ nonce: 'nonce-1' }))).sub).toBe(
            'subject-1',
        );
    });

    test('rejects tokens that are not for this client and ceremony', async () => {
        const now = Math.floor(Date.now() / 1000);
        expect(await reason(exchange(stub.idClaims({ nonce: 'other' })))).toBe(
            'invalid-token',
        );
        expect(
            await reason(exchange(stub.idClaims({ aud: 'another-client' }))),
        ).toBe('invalid-token');
        expect(
            await reason(
                exchange(stub.idClaims({ iss: 'https://evil.example.com' })),
            ),
        ).toBe('invalid-token');
        expect(await reason(exchange(stub.idClaims({ exp: now - 120 })))).toBe(
            'invalid-token',
        );
        expect(await reason(exchange(stub.idClaims(), 'w'.repeat(43)))).toBe(
            'rejected-by-provider',
        );
    });

    test('rejects a forged signature and alg none', async () => {
        const verify = (token: string) =>
            reason(
                (
                    provider as unknown as {
                        verify(token: string, now: number): Promise<unknown>;
                    }
                ).verify(token, Date.now()),
            );
        const token = await stub.sign(stub.idClaims());
        const [head, , signature] = token.split('.');
        const forged = `${head}.${Buffer.from(JSON.stringify(stub.idClaims({ sub: 'someone-else' }))).toString('base64url')}.${signature}`;
        expect(await verify(forged)).toBe('invalid-token');
        expect(
            await verify(await stub.sign(stub.idClaims(), { alg: 'none' })),
        ).toBe('invalid-token');
        expect(await verify('not.a.jwt.at-all')).toBe('invalid-token');
    });

    test('fetches the JWKS again when the provider rotates its key', async () => {
        await exchange(stub.idClaims());
        await stub.rotateKey('key-2');
        expect((await exchange(stub.idClaims())).sub).toBe('subject-1');
    });

    test('verifies back-channel logout tokens', async () => {
        const now = Math.floor(Date.now() / 1000);
        const logout = (overrides: Record<string, unknown> = {}) =>
            stub.sign({
                ...stub.idClaims(),
                jti: crypto.randomUUID(),
                events: {
                    'http://schemas.openid.net/event/backchannel-logout': {},
                },
                ...overrides,
            });
        expect(
            (await provider.verifyLogoutToken(await logout(), Date.now())).sub,
        ).toBe('subject-1');
        expect(
            await reason(
                provider.verifyLogoutToken(
                    await logout({ nonce: 'n' }),
                    Date.now(),
                ),
            ),
        ).toBe('invalid-token');
        expect(
            await reason(
                provider.verifyLogoutToken(
                    await logout({ events: {} }),
                    Date.now(),
                ),
            ),
        ).toBe('invalid-token');
        expect(
            await reason(
                provider.verifyLogoutToken(
                    await logout({ iat: now - 600 }),
                    Date.now(),
                ),
            ),
        ).toBe('invalid-token');
        expect(
            await reason(
                provider.verifyLogoutToken(
                    await logout({ jti: undefined }),
                    Date.now(),
                ),
            ),
        ).toBe('invalid-token');
    });
});
