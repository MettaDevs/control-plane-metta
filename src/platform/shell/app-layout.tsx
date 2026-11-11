import { SidebarInset, SidebarProvider } from '@control-plane-metta/ui/sidebar';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Outlet } from '@tanstack/react-router';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { meQuery } from './api.ts';
import { AppSidebar } from './app-sidebar.tsx';
import { AppSidebarHeader } from './app-sidebar-header.tsx';
import { useDocumentTitle } from './use-document-title.ts';

function sidebarOpen(): boolean {
    // Cookie yang ditulis SidebarProvider @control-plane-metta/ui; bawaannya terbuka.
    return !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(document.cookie);
}

/**
 * Bingkai halaman setelah login, disalin dari bingkai layar operations-metta: rail dan submenu di kiri, header, lalu
 * isi halaman. Halaman hanya merender isinya sendiri. Data operatornya dari `/api/v1/me`, yang sudah dimuat route
 * sebelum bingkai ini dirender.
 */
export function AppLayout(): ReactNode {
    const { data: me } = useSuspenseQuery(meQuery);
    const [isScrolled, setIsScrolled] = useState(false);
    const [defaultOpen] = useState(sidebarOpen);
    useDocumentTitle('Konsol operator');

    return (
        <SidebarProvider
            defaultOpen={defaultOpen}
            className="h-svh min-h-0 min-w-[320px] overflow-hidden"
            style={
                {
                    '--sidebar-width': '16rem',
                    '--sidebar-width-icon': '5.5rem',
                } as CSSProperties
            }
        >
            <AppSidebar />
            <SidebarInset className="h-svh min-w-0 overflow-hidden bg-muted/30 py-2 pr-2 pl-0">
                <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
                    <AppSidebarHeader
                        operator={me.operator}
                        sso={me.sso}
                        isScrolled={isScrolled}
                    />
                    <div
                        data-shell-content=""
                        className="@container/shell-content relative isolate min-h-0 min-w-0 flex-1 overflow-hidden"
                    >
                        <div
                            data-shell-page-content=""
                            scroll-region=""
                            className="relative isolate z-0 h-full min-h-0 min-w-0 overflow-auto bg-muted/30 has-[[data-layout=full-height]]:overflow-hidden"
                            onScroll={(event) =>
                                setIsScrolled(event.currentTarget.scrollTop > 8)
                            }
                        >
                            <Outlet />
                        </div>
                        <div
                            data-shell-overlay-host=""
                            className="pointer-events-none absolute inset-0 z-10"
                        />
                    </div>
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}
