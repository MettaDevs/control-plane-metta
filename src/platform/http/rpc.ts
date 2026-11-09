import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { type Database, sqlErrorCode } from '../database/index.ts';
import { HttpFailure } from './errors.ts';

export type Context = {
    db: Database;
    request: Request;
    clientAddress: string;
    errorHeaders: Record<string, string>;
    // Cookie yang dipasang serve() pada respons, termasuk respons error.
    setCookies: string[];
    // Byte isi request persis seperti diterima, untuk digest dan tanda tangan; oRPC membaca salinan lain.
    rawBody: () => Promise<Uint8Array>;
};

export const ok = (body: object) => ({ status: 200, headers: {}, body });

// HttpFailure menjadi respons dengan status dan body-nya sendiri. Kegagalan lain dicatat tanpa isi request dan
// dijawab 500 yang tidak menyebut penyebabnya.
export const base = os.$context<Context>().use(async ({ context, next }) => {
    try {
        return await next();
    } catch (error) {
        if (error instanceof HttpFailure) {
            context.errorHeaders = error.headers;
            throw new ORPCError('HTTP_FAILURE', {
                status: error.status,
                data: error.body,
                message: error.message,
            });
        }
        process.stderr.write(
            JSON.stringify(
                error instanceof z.ZodError
                    ? {
                          event: 'row-validation-failed',
                          fields: error.issues.map((issue) =>
                              issue.path.join('.'),
                          ),
                      }
                    : {
                          event: 'request-failed',
                          error:
                              error instanceof Error
                                  ? error.name
                                  : typeof error,
                          code: sqlErrorCode(error),
                          message:
                              error instanceof Error
                                  ? error.message
                                  : undefined,
                      },
            ) + '\n',
        );
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
            status: 500,
            data: { message: 'Server Error' },
        });
    }
});

// Setiap proses menjawab /up tanpa menyentuh database, untuk pemeriksaan hidup container dan load balancer.
export const healthRoutes = () => ({
    up: base
        .route({ method: 'GET', path: '/up' })
        .handler(() => ({ status: 'ok' })),
});
