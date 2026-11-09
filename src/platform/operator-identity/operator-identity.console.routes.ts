import { z } from 'zod';
import type { Config } from '../config/index.ts';
import { HttpFailure } from '../http/index.ts';
import {
    authenticate,
    findSessionOperator,
    revokeSessions,
    twoFactorEnabled,
} from './operator.service.ts';
import { SecretBox } from './secret-box.ts';
import {
    type ConsoleSession,
    consoleSession,
    guardAttempts,
    twoFactorWindowSeconds,
} from './session.console.ts';
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

export function operatorRoutes(
    config: Config,
    session: ConsoleSession = consoleSession(config),
) {
    const box = new SecretBox(config.key, 'two-factor');
    const {
        issue,
        read,
        setCookie,
        cookieName,
        consoleBase,
        operatorProcedure,
        confirmed,
    } = session;

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
                setCookie(context, cookieName('two-factor'), '', 0);
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
                setCookie(context, cookieName('session'), '', 0);
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
    return routes;
}
