import { z } from 'zod';
import type { Config } from '../config/index.ts';
import { base, type Context, HttpFailure } from '../http/index.ts';
import { RateLimiter } from '../rate-limit/index.ts';
import {
    authenticate,
    findSessionOperator,
    type Operator,
    revokeSessions,
} from './operator.service.ts';
import { readCookie, readSession, signSession } from './session-cookie.ts';

const loginInput = z.object({
    body: z.object({ email: z.string(), password: z.string() }),
});
const loginLimit = { maxAttempts: 5, decaySeconds: 60 };
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sessionCookie(config: Config, value: string, maxAge: number): string {
    const secure = config.SESSION_SECURE_COOKIE === 'true' ? '; Secure' : '';
    return `${config.SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

function issueSession(config: Config, context: Context, operatorId: string) {
    const now = Date.now();
    const lifetime = config.SESSION_LIFETIME * 60;
    context.setCookies.push(
        sessionCookie(
            config,
            signSession(config.key, {
                operatorId,
                issuedAt: now,
                expiresAt: now + lifetime * 1000,
            }),
            lifetime,
        ),
    );
}

export function operatorRoutes(config: Config) {
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
        const value = readCookie(context.request, config.SESSION_COOKIE);
        const session = value
            ? readSession(config.key, value, Date.now())
            : null;
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
        const lifetime = config.SESSION_LIFETIME * 60;
        context.setCookies.push(
            sessionCookie(
                config,
                signSession(config.key, {
                    ...session,
                    expiresAt: Date.now() + lifetime * 1000,
                }),
                lifetime,
            ),
        );
        return next({ context: { operator, session } });
    });

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
                const limiter = new RateLimiter(context.db, loginLimit);
                const key = `console-login:${email.toLowerCase()}|${context.clientAddress}`;
                const retryAfter = await limiter.retryAfter(key);
                if (retryAfter !== null)
                    throw new HttpFailure(
                        429,
                        {
                            message: `Terlalu banyak percobaan. Coba lagi dalam ${retryAfter} detik.`,
                        },
                        { 'Retry-After': String(retryAfter) },
                    );
                const operator = await authenticate(
                    context.db,
                    email,
                    password,
                );
                if (!operator) {
                    await limiter.hit(key);
                    throw new HttpFailure(422, {
                        message: 'Email atau password tidak cocok.',
                        errors: { email: ['Email atau password tidak cocok.'] },
                    });
                }
                await limiter.clear(key);
                issueSession(config, context, operator.id);
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
                context.setCookies.push(sessionCookie(config, '', 0));
            }),
        me: operatorProcedure
            .route({ method: 'GET', path: '/api/v1/me' })
            .handler(({ context }): { operator: Operator } => ({
                operator: context.operator,
            })),
    };
    return { consoleBase, operatorProcedure, routes };
}
