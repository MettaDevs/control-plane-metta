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
import { api, meQuery } from './api.portal.ts';
import { AuthLayout } from './auth-layout.tsx';
import { PortalLayout } from './portal-layout.portal.tsx';
import { queryClient, type RouterContext } from './runtime.tsx';

function NotFound(): ReactNode {
    return (
        <div className="flex flex-col items-start gap-3 p-6">
            <h1 className="text-sm font-semibold">Halaman tidak ditemukan</h1>
            <p className="text-sm text-muted-foreground">
                Alamat ini tidak menunjuk halaman mana pun.
            </p>
            <Button asChild variant="outline" size="sm">
                <Link to="/">Ke halaman utama</Link>
            </Button>
        </div>
    );
}

function ShellError({ error }: ErrorComponentProps): ReactNode {
    const router = useRouter();
    return (
        <main className="flex min-h-svh items-center justify-center bg-background p-6">
            <div className="flex max-w-md flex-col gap-4 rounded-xl border bg-card p-6">
                <h1 className="text-sm font-semibold">
                    Portal belum dapat dibuka
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

// Halaman di dalam bingkai portal. Tanpa sesi, atau bila aksesnya sudah dicabut, pengguna dibawa ke login.
export const appLayoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_app',
    beforeLoad: async ({ context }): Promise<void> => {
        try {
            await context.queryClient.ensureQueryData(meQuery);
        } catch (error) {
            if (error instanceof ApiError && error.status === 401)
                throw redirect({ href: '/login' });
            throw error;
        }
    },
    component: PortalLayout,
    errorComponent: ShellError,
});

// Halaman sebelum login: login dan undangan.
export const authLayoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_auth',
    component: AuthLayout,
});
