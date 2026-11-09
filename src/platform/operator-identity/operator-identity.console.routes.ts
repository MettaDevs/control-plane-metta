import { z } from 'zod';
import type { Config } from '../config/index.ts';
import { base, type Context, HttpFailure } from '../http/index.ts';
import { RateLimiter } from '../rate-limit/index.ts';
import {
    authenticate,
    confirmPassword,
    findSessionOperator,
    type Operator,
    revokeSessions,
    twoFactorEnabled,
} from './operator.service.ts';
import { SecretBox } from './secret-box.ts';
import {
    type CookiePurpose,
    readCookie,
    readSession,
    signSession,
} from './session-cookie.ts';
import { otpauthUri } from './totp.ts';
import {
    confirmEnrollment,
    disableTwoFactor,
    startEnrollment,
    verifySecondFactor,
} from './two-factor.service.ts';

const loginInput = z.object({
    body: z.object({ email: z.string(), password: z.string() }),
});
const codeInput = z.object({ body: z.object({ code: z.string() }) });
const passwordInput = z.object({ body: z.object({ password: z.string() }) });
const attemptLimit = { maxAttempts: 5, decaySeconds: 60 };
// Sama dengan konsol CoreERP: kode 2FA harus dimasukkan dalam lima menit sesudah password benar.
const twoFactorWindowSeconds = 5 * 60;
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Percobaan yang gagal dihitung per kunci; hasil percobaan yang berhasil dikembalikan.
async function guardAttempts<T>(
    context: Context,
    key: string,
    attempt: () => Promise<T | null | false>,
    failure: object,
): Promise<T> {
    const limiter = new RateLimiter(context.db, attemptLimit);
    const retryAfter = await limiter.retryAfter(key);
    if (retryAfter !== null)
        throw new HttpFailure(
            429,
            {
                message: `Terlalu banyak percobaan. Coba lagi dalam ${retryAfter} detik.`,
            },
            { 'Retry-After': String(retryAfter) },
        );
    const result = await attempt();
    if (result === null || result === false) {
        await limiter.hit(key);
        throw new HttpFailure(422, failure);
    }
    await limiter.clear(key);
    return result;
}

export function operatorRoutes(config: Config) {
    const box = new SecretBox(config.key);
    const cookieName = (purpose: CookiePurpose) =>
        purpose === 'session'
            ? config.SESSION_COOKIE
            : `${config.SESSION_COOKIE}_two_factor`;

    function setCookie(
        context: Context,
        purpose: CookiePurpose,
        value: string,
        maxAge: number,
    ) {
        const secure =
            config.SESSION_SECURE_COOKIE === 'true' ? '; Secure' : '';
        context.setCookies.push(
            `${cookieName(purpose)}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`,
        );
    }

    function issue(
        context: Context,
        purpose: CookiePurpose,
        operatorId: string,
        seconds: number,
        issuedAt = Date.now(),
    ) {
        setCookie(
            context,
            purpose,
            signSession(
                config.key,
                {
                    operatorId,
                    issuedAt,
                    expiresAt: Date.now() + seconds * 1000,
                },
                purpose,
            ),
            seconds,
        );
    }

    const read = (context: Context, purpose: CookiePurpose) => {
        const value = readCookie(context.request, cookieName(purpose));
        return value
            ? readSession(config.key, value, Date.now(), purpose)
            : null;
    };

    // Cookie sesi SameSite=Strict, dan setiap request yang mengubah sesuatu wajib JSON. Form dari situs lain tidak bisa
    // mengirim JSON tanpa preflight CORS, yang tidak pernah diizinkan konsol.
    const consoleBase = base.use(({ context, next }) => {
        const type = context.request.headers.get('content-type') ?? '';
        if (
            unsafeMethods.has(context.request.method) &&
            !/^application\/json\b/i.test(type)
        )
            throw new HttpFailure(415, {
                message: 'Kirim permintaan ini sebagai JSON.',
            });
        return next();
    });

    // Setiap akun di tabel operators adalah operator, jadi yang tidak punya sesi sah mendapat 401. Tidak ada akun
    // customer yang bisa login di sini untuk menerima 403.
    const operatorProcedure = consoleBase.use(async ({ context, next }) => {
        const session = read(context, 'session');
        const operator = session
            ? await findSessionOperator(
                  context.db,
                  session.operatorId,
                  session.issuedAt,
              )
            : null;
        if (!session || !operator)
            throw new HttpFailure(401, { message: 'Unauthenticated.' });
        // Masa sesi diperpanjang di setiap request, sama dengan sesi konsol CoreERP; waktu login tetap.
        issue(
            context,
            'session',
            operator.id,
            config.SESSION_LIFETIME * 60,
            session.issuedAt,
        );
        return next({ context: { operator, session } });
    });

    const confirmed = async (
        context: Context & { operator: Operator },
        password: string,
    ) =>
        guardAttempts(
            context,
            `console-confirm:${context.operator.id}|${context.clientAddress}`,
            () => confirmPassword(context.db, context.operator.id, password),
            {
                message: 'Password tidak cocok.',
                errors: { password: ['Password tidak cocok.'] },
            },
        );

    const routes = {
        login: consoleBase
            .route({
                method: 'POST',
                path: '/login',
                inputStructure: 'detailed',
            })
            .input(loginInput)
            .handler(async ({ context, input }) => {
                const { email, password } = input.body;
                const { operator, twoFactor } = await guardAttempts(
                    context,
                    `console-login:${email.toLowerCase()}|${context.clientAddress}`,
                    () => authenticate(context.db, email, password),
                    {
                        message: 'Email atau password tidak cocok.',
                        errors: { email: ['Email atau password tidak cocok.'] },
                    },
                );
                // Password benar tetapi 2FA aktif: belum ada sesi, hanya cookie tunggu yang berlaku lima menit.
                if (twoFactor) {
                    issue(
                        context,
                        'two-factor',
                        operator.id,
                        twoFactorWindowSeconds,
                    );
                    return { two_factor_required: true };
                }
                issue(
                    context,
                    'session',
                    operator.id,
                    config.SESSION_LIFETIME * 60,
                );
                return { operator };
            }),
        loginTwoFactor: consoleBase
            .route({
                method: 'POST',
                path: '/login/two-factor',
                inputStructure: 'detailed',
            })
            .input(codeInput)
            .handler(async ({ context, input }) => {
                const pending = read(context, 'two-factor');
                const operator = pending
                    ? await findSessionOperator(
                          context.db,
                          pending.operatorId,
                          pending.issuedAt,
                      )
                    : null;
                if (!pending || !operator)
                    throw new HttpFailure(401, {
                        message:
                            'Waktu memasukkan kode sudah habis. Login lagi.',
                    });
                await guardAttempts(
                    context,
                    `console-two-factor:${operator.id}|${context.clientAddress}`,
                    () =>
                        verifySecondFactor(
                            context.db,
                            box,
                            operator.id,
                            input.body.code,
                            Date.now(),
                        ),
                    {
                        message: 'Kode tidak cocok.',
                        errors: { code: ['Kode tidak cocok.'] },
                    },
                );
                setCookie(context, 'two-factor', '', 0);
                issue(
                    context,
                    'session',
                    operator.id,
                    config.SESSION_LIFETIME * 60,
                );
                return { operator };
            }),
        logout: operatorProcedure
            .route({ method: 'POST', path: '/logout', successStatus: 204 })
            .handler(async ({ context }) => {
                // Logout mencabut semua sesi operator ini, termasuk di perangkat lain.
                await revokeSessions(
                    context.db,
                    context.operator.id,
                    Date.now(),
                );
                context.setCookies.length = 0;
                setCookie(context, 'session', '', 0);
            }),
        me: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/me' })
            .handler(async ({ context }) => ({
                operator: context.operator,
                two_factor_enabled: await twoFactorEnabled(
                    context.db,
                    context.operator.id,
                ),
            })),
        // Pendaftaran 2FA: secret baru, belum diminta saat login sampai dikonfirmasi dengan kode dari aplikasi.
        startTwoFactor: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/two-factor',
                inputStructure: 'detailed',
            })
            .input(passwordInput)
            .handler(async ({ context, input }) => {
                await confirmed(context, input.body.password);
                const secret = await startEnrollment(
                    context.db,
                    box,
                    context.operator.id,
                );
                // Nama penerbit diambil dari host konsol, bukan nama perusahaan yang ditulis mati.
                const issuer = new URL(context.request.url).hostname;
                return {
                    secret,
                    otpauth_uri: otpauthUri(
                        secret,
                        issuer,
                        context.operator.email,
                    ),
                };
            }),
        confirmTwoFactor: operatorProcedure
            .route({
                method: 'POST',
                path: '/api/v1/two-factor/confirm',
                inputStructure: 'detailed',
            })
            .input(codeInput)
            .handler(async ({ context, input }) => ({
                // Ditampilkan sekali ini saja; yang tersimpan hanya bentuk terenkripsinya.
                recovery_codes: await confirmEnrollment(
                    context.db,
                    box,
                    {
                        operatorId: context.operator.id,
                        ipAddress: context.clientAddress,
                    },
                    input.body.code.trim(),
                    Date.now(),
                ),
            })),
        disableTwoFactor: operatorProcedure
            .route({
                method: 'DELETE',
                path: '/api/v1/two-factor',
                inputStructure: 'detailed',
                successStatus: 204,
            })
            .input(passwordInput)
            .handler(async ({ context, input }) => {
                await confirmed(context, input.body.password);
                await disableTwoFactor(context.db, {
                    operatorId: context.operator.id,
                    ipAddress: context.clientAddress,
                });
            }),
    };
    return { consoleBase, operatorProcedure, routes };
}
