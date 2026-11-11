import { Button } from '@control-plane-metta/ui/button';
import {
    createRootRouteWithContext,
    createRoute,
    Link,
    Outlet,
    redirect,
    useRouter,
} from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ApiError, errorText } from './api-client.ts';
import { api, meQuery } from './api.ts';
import { AppLayout } from './app-layout.tsx';
import { AuthLayout } from './auth-layout.tsx';
import { homePath } from './navigation.ts';
import { queryClient, type RouterContext } from './runtime.tsx';

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
