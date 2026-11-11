import { ORPCError } from '@orpc/client';
import type { AnyContractRouter } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';

// Dua bentuk kegagalan di API konsol dan portal: `{ message, errors? }` dan `{ error: '<kode>', message }`.
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

// Cookie sesi SameSite=Strict ikut terkirim. Konsol dan portal menolak perubahan yang tidak dikirim sebagai JSON, jadi
// permintaan tanpa body, misalnya logout, tetap diberi Content-Type JSON. `contract` adalah bentuk route proses yang
// dipanggil, hasil scripts/generate-client.ts.
export const apiLink = (contract: AnyContractRouter) =>
    new OpenAPILink(contract, {
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
