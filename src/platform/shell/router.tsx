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
import {
    createRootRouteWithContext,
    createRoute,
    Link,
    Outlet,
    redirect,
    RouterProvider,
    useRouter,
} from '@tanstack/react-router';
import type { AnyRouter, ErrorComponentProps } from '@tanstack/react-router';
import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import { api, ApiError, errorText, meQuery } from './api.ts';
import { AppLayout } from './app-layout.tsx';
import { AuthLayout } from './auth-layout.tsx';
import { homePath } from './navigation.ts';
import { initializeTheme } from './use-appearance.ts';

let activeRouter: AnyRouter | null = null;

// Sesi yang habis saat sebuah daftar atau halaman memuat data membawa operator ke layar login, lalu kembali ke tempat
// semula setelah masuk. Kegagalan simpan tidak berpindah layar: form menampilkan pesannya dan isiannya tetap.
const queryClient = new QueryClient({
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

function NotFound(): ReactNode {
    return (
        <div className="flex flex-col items-start gap-3 p-6">
            <h1 className="text-sm font-semibold">Halaman tidak ditemukan</h1>
            <p className="text-sm text-muted-foreground">
                Alamat ini tidak menunjuk halaman mana pun.
            </p>
            <Button asChild variant="outline" size="sm">
                <Link to={homePath}>Ke daftar customer</Link>
            </Button>
        </div>
    );
}

// Data operator gagal dimuat karena gangguan server. Pesannya tetap terlihat sampai operator mencoba lagi atau keluar.
function ShellError({ error }: ErrorComponentProps): ReactNode {
    const router = useRouter();
    return (
        <main className="flex min-h-svh items-center justify-center bg-background p-6">
            <div className="flex max-w-md flex-col gap-4 rounded-xl border bg-card p-6">
                <h1 className="text-sm font-semibold">
                    Konsol belum dapat dibuka
                </h1>
                <p className="text-sm" role="alert">
                    {errorText(error, 'Data akun belum dapat dimuat.')}
                </p>
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        onClick={() => {
                            void queryClient.resetQueries(meQuery);
                            void router.invalidate();
                        }}
                    >
                        Coba lagi
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                            await api.logout().catch(() => {});
                            window.location.assign('/login');
                        }}
                    >
                        Keluar
                    </Button>
                </div>
            </div>
        </main>
    );
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: Outlet,
    notFoundComponent: NotFound,
});

// Halaman di dalam bingkai konsol. Data operator dimuat sebelum halaman mana pun dirender; tanpa sesi, operator dibawa
// ke login.
export const appLayoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_app',
    beforeLoad: async ({ context, location }): Promise<void> => {
        try {
            await context.queryClient.ensureQueryData(meQuery);
        } catch (error) {
            if (error instanceof ApiError && error.status === 401)
                throw redirect({
                    href: `/login?redirect=${encodeURIComponent(location.href)}`,
                });
            throw error;
        }
    },
    component: AppLayout,
    errorComponent: ShellError,
});

// Halaman sebelum login.
export const authLayoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_auth',
    component: AuthLayout,
});

// Upacara SSO selesai di `/`, jadi alamat ini membawa operator ke halaman pertama konsol.
export const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: (): never => {
        throw redirect({ href: homePath });
    },
});

// Data halaman gagal dimuat: pesannya tetap terlihat di tempat halaman, dengan jalan untuk mencoba lagi. Bingkai konsol
// tetap ada, jadi operator masih bisa berpindah ke halaman lain.
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
