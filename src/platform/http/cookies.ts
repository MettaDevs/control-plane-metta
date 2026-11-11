import type { Context } from './rpc.ts';

export type CookieOptions = {
    secure: boolean;
    sameSite?: 'Strict' | 'Lax';
    path?: string;
};

export function readCookie(request: Request, name: string): string | null {
    for (const part of (request.headers.get('cookie') ?? '').split(';')) {
        const position = part.indexOf('=');
        if (position > 0 && part.slice(0, position).trim() === name)
            return part.slice(position + 1).trim();
    }
    return null;
}

// Cookie HttpOnly yang dipasang serve() pada respons, termasuk respons error. Max-Age 0 menghapusnya.
export function setCookie(
    context: Context,
    name: string,
    value: string,
    maxAge: number,
    options: CookieOptions,
): void {
    context.setCookies.push(
        `${name}=${value}; Path=${options.path ?? '/'}; Max-Age=${maxAge}; HttpOnly; SameSite=${options.sameSite ?? 'Strict'}${options.secure ? '; Secure' : ''}`,
    );
}
