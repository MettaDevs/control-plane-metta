import { z } from 'zod';
import type { Config } from '../../config/index.ts';
import { HttpFailure } from '../../http/index.ts';
import { findSessionOperator } from '../operator.service.ts';
import { SecretBox } from '../../secret-box/index.ts';
import { type ConsoleSession, guardAttempts } from '../session.console.ts';
import { otpauthUri } from './totp.ts';
import {
    confirmEnrollment,
    disableTwoFactor,
    startEnrollment,
    verifySecondFactor,
} from './two-factor.service.ts';

const codeInput = z.object({ body: z.object({ code: z.string() }) });
const passwordInput = z.object({ body: z.object({ password: z.string() }) });

export function twoFactorRoutes(config: Config, session: ConsoleSession) {
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

    return {
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
}
