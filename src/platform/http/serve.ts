import { OpenAPIHandler } from '@orpc/openapi/fetch';
import type { Router } from '@orpc/server';
import { Elysia } from 'elysia';
import type { Config } from '../config/index.ts';
import { createPool, Database } from '../database/index.ts';
import {
    flushErrorReporting,
    startErrorReporting,
} from '../error-reporting/index.ts';
import type { Context } from './rpc.ts';
import type { ClientBuild } from './spa.ts';

type Application = {
    handle(request: Request, clientAddress?: string): Promise<Response>;
    close(): Promise<void>;
};

// Satu proses, satu router. Konsol dan agen memanggil fungsi ini dengan router audiensnya masing-masing, jadi rute
// yang tidak ada di router itu tidak bisa dijangkau dari prosesnya. Hanya proses yang memberi `client` menyajikan
// layar; proses lain menjawab URL layar dengan 404 JSON seperti alamat lain yang tidak ada.
export function createApplication(
    config: Config,
    router: Router<any, Context>,
    client: ClientBuild | null = null,
): Application {
    const pool = createPool(config);
    const handler = new OpenAPIHandler(router, {
        customErrorResponseBodyEncoder: (error) =>
            error.data ?? { message: error.message },
    });
    return {
        async handle(request, clientAddress = '') {
            // Berkas build dan dokumen layar tidak membuka koneksi database.
            const served = await client?.serve(request);
            if (served) return served;
            const db = new Database(pool);
            const copy = request.clone();
            let body: Promise<Uint8Array<ArrayBuffer>> | undefined;
            const context: Context = {
                db,
                request,
                clientAddress,
                errorHeaders: {},
                setCookies: [],
                rawBody: () =>
                    (body ??= copy
                        .arrayBuffer()
                        .then((buffer) => new Uint8Array(buffer))),
            };
            try {
                const result = await handler.handle(request, { context });
                const response =
                    result.response ??
                    Response.json({ message: 'Not Found' }, { status: 404 });
                for (const [name, value] of Object.entries(
                    context.errorHeaders,
                ))
                    response.headers.set(name, value);
                for (const cookie of context.setCookies)
                    response.headers.append('Set-Cookie', cookie);
                // Route yang menetapkan kebijakan cache sendiri, misalnya berkas rilis no-store, tidak ditimpa.
                if (!response.headers.has('Cache-Control'))
                    response.headers.set('Cache-Control', 'no-cache, private');
                return response;
            } finally {
                await db.release();
            }
        },
        close: () => pool.end(),
    };
}

export function serve(
    name: string,
    config: Config,
    router: Router<any, Context>,
    client: ClientBuild | null = null,
): { stop: () => Promise<void> } {
    startErrorReporting(config, name);
    const application = createApplication(config, router, client);
    const app = new Elysia({ aot: true, precompile: true });
    app.all(
        '*',
        ({ request, server }) =>
            application.handle(
                request,
                server?.requestIP(request)?.address ?? '',
            ),
        { parse: 'none' },
    );
    app.listen({
        hostname: config.HOST,
        port: config.PORT,
        reusePort: true,
        // Bawaan Bun memutus koneksi sesudah 10 detik; request yang lebih lambat harus tetap dijawab.
        idleTimeout: 255,
    });
    process.stderr.write(
        JSON.stringify({
            event: 'listening',
            process: name,
            host: config.HOST,
            port: app.server?.port,
        }) + '\n',
    );
    const stop = async () => {
        await app.stop();
        await application.close();
        await flushErrorReporting();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    return { stop };
}
