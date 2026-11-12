import { z } from 'zod';
import type { Config } from '../../platform/config/index.ts';
import {
    type Context,
    HttpFailure,
    jsonBase,
    readCookie,
    setCookie,
} from '../../platform/http/index.ts';
import { SecretBox } from '../../platform/secret-box/index.ts';
import {
    activeTenant,
    hasLiveAccess,
    type PortalIdentity,
} from './portal-identity.service.ts';

// Sesi portal tidak punya tabel, sama dengan sesi konsol: cookie terenkripsi memuat identitas SSO dan waktu login.
// Setiap request memeriksa ulang bahwa identitas itu masih memegang akses hidup, jadi akses yang dicabut operator
// berakhir di request berikutnya.
const sessionSchema = z.object({
    issuer: z.string(),
    subject: z.string(),
    // Milidetik, supaya login sesaat sesudah logout tidak jatuh di detik yang sama dengan pencabutannya.
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
});

export function portalSession(config: Config) {
    const cookieName = `${config.SESSION_COOKIE}_portal`;
    // Tenant aktif, pilihan pengguna di header portal. Isinya hanya id tenant: setiap request memeriksa ulang bahwa
    // identitas sesi masih memegang akses ke tenant itu, dan yang tidak lagi dipegang diganti tenant pertamanya.
    const tenantCookieName = `${cookieName}_tenant`;
    const box = new SecretBox(config.key, 'portal-session');
    const secure = config.SESSION_SECURE_COOKIE === 'true';
    const lifetime = config.SESSION_LIFETIME * 60;

    function issue(
        context: Context,
        identity: PortalIdentity,
        issuedAt = Date.now(),
    ) {
        const session = {
            ...identity,
            issuedAt,
            expiresAt: Date.now() + lifetime * 1000,
        };
        setCookie(
            context,
            cookieName,
            box.seal(JSON.stringify(session)),
            lifetime,
            { secure },
        );
    }

    function clear(context: Context) {
        setCookie(context, cookieName, '', 0, { secure });
        setCookie(context, tenantCookieName, '', 0, { secure });
    }

    // Menggantikan cookie tenant yang sudah dipasang request ini, supaya jawabannya hanya membawa satu pilihan.
    function chooseTenant(context: Context, tenantId: string) {
        const previous = context.setCookies.findIndex((cookie) =>
            cookie.startsWith(`${tenantCookieName}=`),
        );
        if (previous >= 0) context.setCookies.splice(previous, 1);
        setCookie(context, tenantCookieName, tenantId, lifetime, { secure });
    }

    function read(context: Context): z.infer<typeof sessionSchema> | null {
        const value = readCookie(context.request, cookieName);
        if (!value) return null;
        try {
            const session = sessionSchema.parse(JSON.parse(box.open(value)));
            return session.expiresAt > Date.now() ? session : null;
        } catch {
            return null;
        }
    }

    // Tidak ada akun lain yang bisa memegang sesi portal, jadi yang tidak punya sesi sah mendapat 401.
    const clientProcedure = jsonBase.use(async ({ context, next }) => {
        const session = read(context);
        const identity = session && {
            issuer: session.issuer,
            subject: session.subject,
        };
        const chosen = readCookie(context.request, tenantCookieName);
        const tenant =
            session &&
            identity &&
            (await hasLiveAccess(context.db, identity, session.issuedAt))
                ? await activeTenant(context.db, identity, chosen)
                : null;
        if (!session || !identity || !tenant) {
            if (session) clear(context);
            throw new HttpFailure(401, { message: 'Unauthenticated.' });
        }
        // Masa sesi diperpanjang di setiap request, sama dengan sesi konsol; waktu login tetap.
        issue(context, identity, session.issuedAt);
        chooseTenant(context, tenant.tenant_id);
        return next({ context: { identity, tenant } });
    });

    return { cookieName, issue, clear, chooseTenant, clientProcedure, secure };
}

export type PortalSession = ReturnType<typeof portalSession>;
