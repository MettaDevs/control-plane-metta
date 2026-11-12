import { z } from 'zod';
import type { Config } from '../../config/index.ts';
import {
    authenticate,
    hasPassword,
    revokeSessions,
    twoFactorEnabled,
} from '../operator.service.ts';
import {
    type ConsoleSession,
    guardAttempts,
    twoFactorWindowSeconds,
} from '../session.console.ts';
import { isLinked } from '../sso/sso.service.ts';

const loginInput = z.object({
    body: z.object({ email: z.string(), password: z.string() }),
});

export function loginRoutes(config: Config, session: ConsoleSession) {
    const { issue, setCookie, cookieName, consoleBase, operatorProcedure } =
        session;

    return {
        // Dibaca layar login sebelum ada sesi: tombol SSO hanya tampil bila CONSOLE_SSO_* diisi.
        loginOptions: consoleBase
            .route({ method: 'GET', path: '/api/v1/login-options' })
            .handler(() => ({ sso: config.sso !== null })),
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
                // null bila SSO konsol tidak disetel; selain itu, apakah operator ini sudah menautkan akun SSO-nya, dan
                // apakah ia punya password: operator tanpa password hanya bisa masuk lewat SSO, jadi tautannya tidak
                // ditawarkan untuk dilepas atau dibuat ulang (keduanya meminta password).
                sso: config.sso
                    ? {
                          linked: await isLinked(
                              context.db,
                              context.operator.id,
                              config.sso.issuer,
                          ),
                          has_password: await hasPassword(
                              context.db,
                              context.operator.id,
                          ),
                      }
                    : null,
            })),
    };
}
