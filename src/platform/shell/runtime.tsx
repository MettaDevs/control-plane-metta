import { Button } from '@control-plane-metta/ui/button';
import { Toaster } from '@control-plane-metta/ui/sonner';
import { Spinner } from '@control-plane-metta/ui/spinner';
import { TooltipProvider } from '@control-plane-metta/ui/tooltip';
import {
    QueryCache,
    QueryClient,
    QueryClientProvider,
    useQueryErrorResetBoundary,
} from '@tanstack/react-query';
import { RouterProvider, useRouter } from '@tanstack/react-router';
import type { AnyRouter, ErrorComponentProps } from '@tanstack/react-router';
import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import { ApiError, errorText } from './api-client.ts';
import { initializeTheme } from './use-appearance.ts';

// Bagian peramban yang sama untuk layar konsol dan layar portal. Route, bingkai, dan klien API milik masing-masing.

let activeRouter: AnyRouter | null = null;

// Sesi yang habis saat sebuah daftar atau halaman memuat data membawa pengguna ke layar login, lalu kembali ke tempat
// semula setelah masuk. Kegagalan simpan tidak berpindah layar: form menampilkan pesannya dan isiannya tetap.
export const queryClient = new QueryClient({
    queryCache: new QueryCache({
        onError: (error) => {
            const location = activeRouter?.state.location;
            if (
                error instanceof ApiError &&
                error.status === 401 &&
                location &&
                location.pathname !== '/login'
            )
                void activeRouter?.navigate({
                    href: `/login?redirect=${encodeURIComponent(location.href)}`,
                });
        },
    }),
    defaultOptions: {
        queries: {
            retry: (failures, error) =>
                !(error instanceof ApiError && error.status < 500) &&
                failures < 2,
        },
    },
});

export type RouterContext = { queryClient: QueryClient };

// Data halaman gagal dimuat: pesannya tetap terlihat di tempat halaman, dengan jalan untuk mencoba lagi. Bingkai tetap
// ada, jadi pengguna masih bisa berpindah ke halaman lain.
function PageError({ error, reset }: ErrorComponentProps): ReactNode {
    const router = useRouter();
    const queries = useQueryErrorResetBoundary();
    return (
        <div className="flex flex-col items-start gap-3 p-6">
            <p role="alert" className="text-sm">
                {errorText(error, 'Halaman ini belum dapat dimuat.')}
            </p>
            <Button
                size="sm"
                variant="outline"
                onClick={() => {
                    queries.reset();
                    reset();
                    void router.invalidate();
                }}
            >
                Coba lagi
            </Button>
        </div>
    );
}

function PagePending(): ReactNode {
    return (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Spinner /> Memuat…
        </div>
    );
}

export const routerOptions = {
    context: { queryClient } satisfies RouterContext,
    defaultPreload: 'intent' as const,
    defaultErrorComponent: PageError,
    defaultPendingComponent: PagePending,
};

export function startClient(router: AnyRouter): void {
    activeRouter = router;
    initializeTheme();
    const element = document.getElementById('app');
    if (!element) throw new Error('Dokumen layar tidak memuat #app.');
    createRoot(element).render(
        <StrictMode>
            <TooltipProvider delayDuration={1000}>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
                <Toaster />
            </TooltipProvider>
        </StrictMode>,
    );
}
