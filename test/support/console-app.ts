import { loadConfig } from '../../src/platform/config/index.ts';
import { createPool } from '../../src/platform/database/index.ts';
import { createApplication } from '../../src/platform/http/index.ts';
import { operatorIdentityRoutes } from '../../src/platform/operator-identity/index.console.ts';

// Route identitas operator di atas database test, dipanggil seperti browser memanggil konsol: lewat Request sungguhan,
// dengan cookie dan alamat IP. Setiap pemanggilan memakai alamat IP sendiri, supaya pembatas percobaan tidak
// terbawa antar-berkas test.
export function consoleTestApp(key: number) {
    const config = loadConfig({
        ...process.env,
        APP_KEY: 'base64:' + Buffer.alloc(32, key).toString('base64'),
        SESSION_SECURE_COOKIE: 'false',
    });
    const application = createApplication(
        config,
        operatorIdentityRoutes(config),
    );
    const pool = createPool(config);
    const address = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

    const call = (
        path: string,
        init: {
            method?: string;
            body?: unknown;
            cookie?: string;
            type?: string;
        } = {},
    ) =>
        application.handle(
            new Request(`http://localhost${path}`, {
                method: init.method ?? 'GET',
                headers: {
                    'content-type': init.type ?? 'application/json',
                    ...(init.cookie ? { cookie: init.cookie } : {}),
                },
                body:
                    init.body === undefined
                        ? undefined
                        : JSON.stringify(init.body),
            }),
            address,
        );

    // `nama=nilai` dari Set-Cookie bernama itu, termasuk cookie yang dikosongkan.
    const cookieOf = (response: Response, name: string) =>
        response.headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith(`${name}=`))
            ?.split(';')[0];

    return {
        config,
        pool,
        call,
        cookieOf,
        sessionOf: (response: Response) =>
            cookieOf(response, config.SESSION_COOKIE) ?? '',
        close: async () => {
            await application.close();
            await pool.end();
        },
    };
}
