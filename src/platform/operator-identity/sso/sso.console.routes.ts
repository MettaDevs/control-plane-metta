import { z } from 'zod';
import type { Config } from '../../config/index.ts';
import {
    base,
    type Context,
    HttpFailure,
    readCookie,
} from '../../http/index.ts';
import {
    OidcProvider,
    randomUrlToken,
    selfNavigatingPage,
    SsoFailure,
} from '../../oidc/index.ts';
import { RateLimiter } from '../../rate-limit/index.ts';
import {
    acceptOperatorInvitation,
    usableOperatorInvitationHash,
} from '../invitation/invitation.service.ts';
import { revokeSessions } from '../operator.service.ts';
import { SecretBox } from '../../secret-box/index.ts';
import {
    type ConsoleSession,
    twoFactorWindowSeconds,
} from '../session.console.ts';
import {
    findLinkedOperator,
    linkIdentity,
    unlinkIdentity,
} from './sso.service.ts';

// Sama dengan konsol CoreERP: upacara SSO berlaku sepuluh menit.
const ceremonySeconds = 10 * 60;
// Logout token diterima sampai lima menit sesudah iat, ditambah toleransi jam.
const logoutReplaySeconds = 300 + 60 + 1;

// Upacara menerima undangan membawa hash token undangan, bukan tokennya. Tautan yang diganti kirim ulang selama
// upacara berjalan tidak lagi cocok di callback.
const ceremonySchema = z.object({
    mode: z.enum(['login', 'link', 'accept']),
    state: z.string(),
    nonce: z.string(),
    verifier: z.string(),
    operatorId: z.uuid().nullable(),
    invitationHash: z.string().nullable(),
    expiresAt: z.number(),
});
type Ceremony = z.infer<typeof ceremonySchema>;

const callbackInput = z.object({
    query: z.object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
    }),
});

export function ssoRoutes(config: Config, session: ConsoleSession) {
    const settings = config.sso;
    const oidc = settings ? new OidcProvider(settings) : null;
    // Tanpa CONSOLE_SSO_* setiap route SSO menjawab 404, sama dengan alamat yang tidak ada.
    const sso = () => {
        if (!oidc) throw new HttpFailure(404, { message: 'Not Found' });
        return oidc;
    };
    const box = new SecretBox(config.key, 'sso-ceremony');
    const ceremonyCookie = `${config.SESSION_COOKIE}_sso`;
    const { issue, setCookie, consoleBase, operatorProcedure, confirmed } =
        session;

    async function begin(
        context: Context,
        mode: Ceremony['mode'],
        operatorId: string | null,
        invitationHash: string | null = null,
    ): Promise<string> {
        const ceremony: Ceremony = {
            mode,
            state: randomUrlToken(),
            nonce: randomUrlToken(),
            verifier: randomUrlToken(),
            operatorId,
            invitationHash,
            expiresAt: Date.now() + ceremonySeconds * 1000,
        };
        const url = await sso().authorizationUrl(ceremony);
        // Lax, karena cookie ini harus ikut saat penyedia SSO mengarahkan browser kembali ke /sso/callback.
        // Isinya terenkripsi, jadi verifier PKCE tidak terbaca walau cookie-nya tersalin.
        setCookie(
            context,
            ceremonyCookie,
            box.seal(JSON.stringify(ceremony)),
            ceremonySeconds,
            { sameSite: 'Lax', path: '/sso' },
        );
        return url;
    }

    function takeCeremony(context: Context): Ceremony | null {
        const value = readCookie(context.request, ceremonyCookie);
        setCookie(context, ceremonyCookie, '', 0, {
            sameSite: 'Lax',
            path: '/sso',
        });
        if (!value) return null;
        try {
            const ceremony = ceremonySchema.parse(JSON.parse(box.open(value)));
            return ceremony.expiresAt > Date.now() ? ceremony : null;
        } catch {
            return null;
        }
    }

    const fail = (reason: string, mode: Ceremony['mode'] = 'login') =>
        selfNavigatingPage(
            `${mode === 'link' ? '/' : '/login'}?sso_error=${encodeURIComponent(reason)}`,
        );

    // Sesudah akun SSO dikenali sebagai operator: 2FA yang dinyalakan operator tetap diminta walau masuk lewat SSO.
    function enter(
        context: Context,
        linked: { operator: { id: string }; twoFactor: boolean },
    ) {
        if (linked.twoFactor) {
            issue(
                context,
                'two-factor',
                linked.operator.id,
                twoFactorWindowSeconds,
            );
            return selfNavigatingPage('/login?two_factor=1');
        }
        issue(
            context,
            'session',
            linked.operator.id,
            config.SESSION_LIFETIME * 60,
        );
        return selfNavigatingPage('/');
    }

    return {
        // Login: `/sso/start`. Menerima undangan operator: `/sso/start?invitation=<token>`; tokennya diperiksa sebelum
        // browser dibawa ke penyedia, supaya tautan yang sudah tidak berlaku tidak meminta login SSO dulu.
        ssoStart: consoleBase
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
                sso();
                const token = input.query.invitation;
                let invitationHash: string | null = null;
                if (token !== undefined) {
                    invitationHash = await usableOperatorInvitationHash(
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
                                null,
                                invitationHash,
                            ),
                        },
                    };
                } catch (error) {
                    if (error instanceof SsoFailure) return fail(error.reason);
                    throw error;
                }
            }),
        ssoCallback: consoleBase
            .route({
                method: 'GET',
                path: '/sso/callback',
                inputStructure: 'detailed',
                outputStructure: 'detailed',
            })
            .input(callbackInput)
            .handler(async ({ context, input }) => {
                sso();
                const ceremony = takeCeremony(context);
                const { code, state } = input.query;
                if (!ceremony || !code || state !== ceremony.state)
                    return fail('invalid-ceremony', ceremony?.mode);
                let claims;
                try {
                    claims = await sso().exchangeCode(
                        code,
                        ceremony.verifier,
                        ceremony.nonce,
                        Date.now(),
                    );
                } catch (error) {
                    if (error instanceof SsoFailure) {
                        process.stderr.write(
                            JSON.stringify({
                                event: 'sso-failed',
                                reason: error.reason,
                                message: error.message,
                            }) + '\n',
                        );
                        return fail(error.reason, ceremony.mode);
                    }
                    throw error;
                }
                const identity = { issuer: claims.iss, subject: claims.sub };
                if (ceremony.mode === 'link') {
                    try {
                        await linkIdentity(
                            context.db,
                            {
                                operatorId: ceremony.operatorId!,
                                ipAddress: context.clientAddress,
                            },
                            { ...identity, email: claims.email ?? null },
                        );
                    } catch (error) {
                        if (error instanceof HttpFailure)
                            return fail('already-linked', 'link');
                        throw error;
                    }
                    return selfNavigatingPage('/?sso=linked');
                }
                if (ceremony.mode === 'accept') {
                    const accepted = await acceptOperatorInvitation(
                        context.db,
                        ceremony.invitationHash!,
                        {
                            ...identity,
                            name: claims.name ?? null,
                            email: claims.email ?? null,
                        },
                        context.clientAddress,
                    );
                    if (accepted.status === 'invalid')
                        return fail('invitation-invalid');
                    if (accepted.status === 'email-taken')
                        return fail('invitation-email-taken');
                    return enter(context, accepted);
                }
                const linked = await findLinkedOperator(context.db, identity);
                if (!linked) return fail('not-linked');
                return enter(context, linked);
            }),
        // Menautkan akun SSO ke operator yang sedang login, dengan password diketik ulang. Browser lalu dibawa ke
        // authorize_url, dan tautannya dibuat di /sso/callback.
        ssoLink: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/sso/link',
                inputStructure: 'detailed',
            })
            .input(z.object({ body: z.object({ password: z.string() }) }))
            .handler(async ({ context, input }) => {
                sso();
                await confirmed(context, input.body.password);
                return {
                    authorize_url: await begin(
                        context,
                        'link',
                        context.operator.id,
                    ),
                };
            }),
        ssoUnlink: operatorProcedure
            .route({
                method: 'DELETE',
                path: '/api/v1/sso/link',
                successStatus: 204,
            })
            .handler(async ({ context }) => {
                await unlinkIdentity(
                    context.db,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    sso().settings.issuer,
                );
            }),
        // Back-channel logout dari penyedia SSO: body form berisi logout_token, tanpa cookie. Semua sesi operator yang
        // tertaut ke sub itu berakhir.
        ssoBackchannelLogout: base
            .route({
                method: 'POST',
                path: '/sso/backchannel-logout',
                inputStructure: 'detailed',
            })
            .input(z.object({ body: z.object({ logout_token: z.string() }) }))
            .handler(async ({ context, input }) => {
                let claims;
                try {
                    claims = await sso().verifyLogoutToken(
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
                const key = `sso-logout:${claims.iss}|${claims.jti}`;
                if ((await limiter.retryAfter(key)) !== null)
                    throw new HttpFailure(400, { error: 'invalid_request' });
                await limiter.hit(key);
                const linked = await findLinkedOperator(context.db, {
                    issuer: claims.iss,
                    subject: claims.sub,
                });
                if (linked)
                    await revokeSessions(
                        context.db,
                        linked.operator.id,
                        Date.now(),
                    );
                return {};
            }),
    };
}
