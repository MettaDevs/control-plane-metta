import { createORPCClient, ORPCError } from '@orpc/client';
import type { AnyContractRouter } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { ConsoleRouter } from '../../console.ts';
import contract from './api-contract.generated.json';

// Dua bentuk kegagalan di API konsol: `{ message, errors? }` dan `{ error: '<kode>', message }`.
type ErrorBody = {
    message?: unknown;
    errors?: Record<string, string[]>;
    error?: unknown;
};

function errorBody(value: unknown): ErrorBody {
    return value !== null && typeof value === 'object'
        ? (value as ErrorBody)
        : {};
}

/**
 * Kegagalan dari API: pesan pertama dari validasi (422) atau pesan jawabannya, beserta status, error per field, dan
 * kodenya (`slug_taken`, `idempotency_key_reused`, ...).
 */
export class ApiError extends ORPCError<'API_ERROR', ErrorBody> {
    readonly errors: Record<string, string[]>;
    readonly errorCode: string | null;

    constructor(status: number, body: unknown) {
        const data = errorBody(body);
        const firstError = data.errors
            ? Object.values(data.errors)[0]?.[0]
            : undefined;
        super('API_ERROR', {
            status,
            data,
            message:
                typeof firstError === 'string'
                    ? firstError
                    : typeof data.message === 'string' && data.message
                      ? data.message
                      : 'Permintaan belum berhasil.',
        });
        this.errors = data.errors ?? {};
        this.errorCode = typeof data.error === 'string' ? data.error : null;
    }
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Cookie sesi konsol SameSite=Strict ikut terkirim. Konsol menolak perubahan yang tidak dikirim sebagai JSON, jadi
// permintaan tanpa body, misalnya logout, tetap diberi Content-Type JSON.
const link = new OpenAPILink(contract as AnyContractRouter, {
    url: () => window.location.origin,
    headers: () => ({ accept: 'application/json' }),
    fetch: (request, init) => {
        if (
            unsafeMethods.has(request.method) &&
            !request.headers.has('content-type')
        )
            request.headers.set('content-type', 'application/json');
        return globalThis.fetch(request, {
            ...init,
            credentials: 'same-origin',
        });
    },
    customErrorResponseBodyDecoder: (body, response) =>
        new ApiError(response.status, body),
});

// Klien bertipe dari router konsol di src/console.ts: input dan output setiap procedure datang dari sana, tidak ditulis
// ulang di layar.
export const api: JsonifiedClient<RouterClient<ConsoleRouter>> =
    createORPCClient(link);
export const orpc = createTanstackQueryUtils(api);

// Jawaban sebuah procedure, untuk tipe data di layar.
export type ApiOutput<K extends keyof typeof api> = Awaited<
    ReturnType<(typeof api)[K]>
>;

export type Operator = ApiOutput<'me'>['operator'];

// Operator yang sedang login, untuk bingkai layar. Tanpa sesi jawabannya 401.
export const meQuery = orpc.me.queryOptions({ staleTime: 60_000 });

export function isSessionExpired(caught: unknown): boolean {
    return caught instanceof ApiError && caught.status === 401;
}

export function errorText(caught: unknown, fallback: string): string {
    if (isSessionExpired(caught))
        return 'Sesi login sudah berakhir. Login lagi untuk melanjutkan; isian di layar ini belum hilang.';
    if (caught instanceof ApiError)
        return caught.status >= 500
            ? `${fallback} Terjadi gangguan sistem. Coba lagi sebentar lagi.`
            : caught.message || fallback;
    return fallback;
}
