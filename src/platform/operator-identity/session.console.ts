import type { Config } from '../config/index.ts';
import { base, type Context, HttpFailure } from '../http/index.ts';
import { RateLimiter } from '../rate-limit/index.ts';
import {
    confirmPassword,
    findSessionOperator,
    type Operator,
} from './operator.service.ts';
import {
    type CookiePurpose,
    readCookie,
    readSession,
    signSession,
} from './session-cookie.ts';

// Bagian sesi konsol yang dipakai bersama route login, 2FA, dan SSO.
export const attemptLimit = { maxAttempts: 5, decaySeconds: 60 };
// Sama dengan konsol CoreERP: kode 2FA harus dimasukkan dalam lima menit sesudah password benar.
export const twoFactorWindowSeconds = 5 * 60;
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Percobaan yang gagal dihitung per kunci; hasil percobaan yang berhasil dikembalikan.
export async function guardAttempts<T>(
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

export function consoleSession(config: Config) {
    const cookieName = (purpose: CookiePurpose) =>
        purpose === 'session'
            ? config.SESSION_COOKIE
            : `${config.SESSION_COOKIE}_two_factor`;

    function setCookie(
        context: Context,
        name: string,
        value: string,
        maxAge: number,
        options: { sameSite?: 'Strict' | 'Lax'; path?: string } = {},
    ) {
        const secure =
            config.SESSION_SECURE_COOKIE === 'true' ? '; Secure' : '';
        context.setCookies.push(
            `${name}=${value}; Path=${options.path ?? '/'}; Max-Age=${maxAge}; HttpOnly; SameSite=${options.sameSite ?? 'Strict'}${secure}`,
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
            cookieName(purpose),
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

    return {
        cookieName,
        setCookie,
        issue,
        read,
        consoleBase,
        operatorProcedure,
        confirmed,
        guardAttempts,
    };
}

export type ConsoleSession = ReturnType<typeof consoleSession>;
