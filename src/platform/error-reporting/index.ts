import * as Sentry from '@sentry/bun';
import type { Config } from '../config/index.ts';

// Kesalahan yang tidak diharapkan dikirim ke Sentry: jawaban 500, kesalahan yang tidak tertangkap di proses, dan
// kesalahan CLI. Penolakan yang memang bagian dari aturan (401, 404, 409, 422, 429) tidak dikirim, karena ia bukan
// kesalahan program. Tanpa SENTRY_DSN tidak ada yang dikirim ke mana pun.
let enabled = false;

export function startErrorReporting(config: Config, process: string): void {
    if (enabled || !config.SENTRY_DSN) return;
    Sentry.init({
        dsn: config.SENTRY_DSN,
        environment: config.SENTRY_ENVIRONMENT,
        release: config.SENTRY_RELEASE,
        tracesSampleRate: 0,
        // Hanya integrasi untuk kesalahan. Bawaannya memasang instrumentasi Bun.serve, HTTP, Postgres, dan
        // puluhan lainnya, yang menambah kerja di setiap request; angka kapasitas stack ini diukur tanpanya.
        defaultIntegrations: false,
        integrations: [
            Sentry.eventFiltersIntegration(),
            Sentry.functionToStringIntegration(),
            Sentry.linkedErrorsIntegration(),
            Sentry.dedupeIntegration(),
            Sentry.contextLinesIntegration(),
            Sentry.onUncaughtExceptionIntegration(),
            Sentry.onUnhandledRejectionIntegration(),
        ],
        initialScope: { tags: { process } },
        // Isi request, header, cookie, dan query bisa memuat password, token, atau data klinik. SDK ini
        // mengumpulkan semuanya secara bawaan, jadi setiap jenis dimatikan, dan beforeSend membuang sisanya: yang
        // tersisa hanya method dan path, cukup untuk menemukan route-nya.
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
        },
        beforeSend(event) {
            if (event.request)
                event.request = {
                    method: event.request.method,
                    url: event.request.url?.split('?')[0],
                };
            delete event.user;
            return event;
        },
    });
    enabled = true;
}

export function reportError(
    error: unknown,
    request?: { method: string; path: string },
): void {
    if (!enabled) return;
    Sentry.withScope((scope) => {
        if (request) {
            scope.setTag('http.method', request.method);
            scope.setTag('http.route', request.path);
        }
        Sentry.captureException(error);
    });
}

// Dipanggil sebelum proses berhenti, supaya kesalahan terakhir sempat terkirim.
export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
    if (enabled) await Sentry.flush(timeoutMs);
}
