import { z } from 'zod';
import type { Config, PortalSettings } from '../../platform/config/index.ts';
import {
    base,
    type Context,
    HttpFailure,
    jsonBase,
    readCookie,
    setCookie,
} from '../../platform/http/index.ts';
import {
    OidcProvider,
    randomUrlToken,
    selfNavigatingPage,
    SsoFailure,
} from '../../platform/oidc/index.ts';
import { RateLimiter } from '../../platform/rate-limit/index.ts';
import { SecretBox } from '../../platform/secret-box/index.ts';
import {
    acceptInvitation,
    hasLiveAccess,
    revokePortalSessions,
    usableInvitationHash,
} from './portal-identity.service.ts';
import type { PortalSession } from './portal-session.portal.ts';

// Sama dengan konsol: upacara SSO berlaku sepuluh menit.
const ceremonySeconds = 10 * 60;
// Logout token diterima sampai lima menit sesudah iat, ditambah toleransi jam.
const logoutReplaySeconds = 300 + 60 + 1;

// Upacara menerima undangan membawa hash token undangan, bukan tokennya. Tautan yang diganti kirim ulang selama
// upacara berjalan tidak lagi cocok di callback.
const ceremonySchema = z.object({
    mode: z.enum(['login', 'accept']),
    state: z.string(),
    nonce: z.string(),
    verifier: z.string(),
    invitationHash: z.string().nullable(),
    expiresAt: z.number(),
});
type Ceremony = z.infer<typeof ceremonySchema>;

const fail = (reason: string) =>
    selfNavigatingPage(`/login?portal_error=${encodeURIComponent(reason)}`);

function logFailure(error: SsoFailure) {
    process.stderr.write(
        JSON.stringify({
            event: 'portal-sso-failed',
            reason: error.reason,
            message: error.message,
        }) + '\n',
    );
}

export function portalSsoRoutes(
    config: Config,
    portal: PortalSettings,
    session: PortalSession,
) {
    const oidc = new OidcProvider(portal.sso);
    const box = new SecretBox(config.key, 'portal-sso-ceremony');
    const ceremonyCookie = `${session.cookieName}_sso`;
    const cookieOptions = {
        secure: session.secure,
        sameSite: 'Lax',
        path: '/sso',
    } as const;

    async function begin(
        context: Context,
        mode: Ceremony['mode'],
        invitationHash: string | null,
    ): Promise<string> {
        const ceremony: Ceremony = {
            mode,
            state: randomUrlToken(),
            nonce: randomUrlToken(),
            verifier: randomUrlToken(),
            invitationHash,
            expiresAt: Date.now() + ceremonySeconds * 1000,
        };
        const url = await oidc.authorizationUrl(ceremony);
        // Lax, karena cookie ini harus ikut saat penyedia SSO mengarahkan browser kembali ke /sso/callback.
        setCookie(
            context,
            ceremonyCookie,
            box.seal(JSON.stringify(ceremony)),
            ceremonySeconds,
            cookieOptions,
        );
        return url;
    }

    function takeCeremony(context: Context): Ceremony | null {
        const value = readCookie(context.request, ceremonyCookie);
        setCookie(context, ceremonyCookie, '', 0, cookieOptions);
        if (!value) return null;
        try {
            const ceremony = ceremonySchema.parse(JSON.parse(box.open(value)));
            return ceremony.expiresAt > Date.now() ? ceremony : null;
        } catch {
            return null;
        }
    }

    return {
        // Login: `/sso/start`. Menerima undangan: `/sso/start?invitation=<token>`; tokennya diperiksa sebelum browser
        // dibawa ke penyedia, supaya tautan yang sudah tidak berlaku tidak meminta login SSO dulu.
        portalSsoStart: jsonBase
            .route({
                method: 'GET',
                path: '/sso/start',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(
                z.object({
                    query: z.object({ invitation: z.string().optional() }),
                }),
            )
            .handler(async ({ context, input }) => {
                const token = input.query.invitation;
                let invitationHash: string | null = null;
                if (token !== undefined) {
                    invitationHash = await usableInvitationHash(
                        context.db,
                        token,
                    );
                    if (!invitationHash) return fail('invitation-invalid');
                }
                try {
                    return {
                        status: 302,
                        headers: {
                            location: await begin(
                                context,
                                invitationHash ? 'accept' : 'login',
                                invitationHash,
                            ),
                        },
                    };
                } catch (error) {
                    if (error instanceof SsoFailure) {
                        logFailure(error);
                        return fail(error.reason);
                    }
                    throw error;
                }
            }),
        portalSsoCallback: jsonBase
            .route({
                method: 'GET',
                path: '/sso/callback',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(
                z.object({
                    query: z.object({
                        code: z.string().optional(),
                        state: z.string().optional(),
                        error: z.string().optional(),
                    }),
                }),
            )
            .handler(async ({ context, input }) => {
                const ceremony = takeCeremony(context);
                const { code, state } = input.query;
                if (!ceremony || !code || state !== ceremony.state)
                    return fail('invalid-ceremony');
                let claims;
                try {
                    claims = await oidc.exchangeCode(
                        code,
                        ceremony.verifier,
                        ceremony.nonce,
                        Date.now(),
                    );
                } catch (error) {
                    if (error instanceof SsoFailure) {
                        logFailure(error);
                        return fail(error.reason);
                    }
                    throw error;
                }
                const identity = { issuer: claims.iss, subject: claims.sub };
                if (ceremony.mode === 'accept') {
                    const accepted = await acceptInvitation(
                        context.db,
                        ceremony.invitationHash!,
                        {
                            ...identity,
                            name: claims.name ?? null,
                            email: claims.email ?? null,
                        },
                        context.clientAddress,
                    );
                    if (!accepted) return fail('invitation-invalid');
                } else if (!(await hasLiveAccess(context.db, identity)))
                    return fail('not-linked');
                session.issue(context, identity);
                return selfNavigatingPage('/');
            }),
        // Back-channel logout dari penyedia SSO: body form berisi logout_token, tanpa cookie. Semua sesi portal identitas
        // itu berakhir.
        portalSsoBackchannelLogout: base
            .route({
                method: 'POST',
                path: '/sso/backchannel-logout',
                inputStructure: 'detailed',
            })
            .input(z.object({ body: z.object({ logout_token: z.string() }) }))
            .handler(async ({ context, input }) => {
                let claims;
                try {
                    claims = await oidc.verifyLogoutToken(
                        input.body.logout_token,
                        Date.now(),
                    );
                } catch (error) {
                    if (error instanceof SsoFailure)
                        throw new HttpFailure(400, {
                            error: 'invalid_request',
                        });
                    throw error;
                }
                const limiter = new RateLimiter(context.db, {
                    maxAttempts: 1,
                    decaySeconds: logoutReplaySeconds,
                });
                const key = `portal-sso-logout:${claims.iss}|${claims.jti}`;
                if ((await limiter.retryAfter(key)) !== null)
                    throw new HttpFailure(400, { error: 'invalid_request' });
                await limiter.hit(key);
                await revokePortalSessions(
                    context.db,
                    { issuer: claims.iss, subject: claims.sub },
                    Date.now(),
                );
                return {};
            }),
    };
}
