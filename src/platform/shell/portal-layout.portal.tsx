import { Avatar, AvatarFallback } from '@control-plane-metta/ui/avatar';
import { Button } from '@control-plane-metta/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@control-plane-metta/ui/dropdown-menu';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import { House, LogOut, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { errorText } from './api-client.ts';
import { api, meQuery } from './api.portal.ts';
import { initials } from './initials.ts';
import { TenantSwitcher } from './tenant-switcher.portal.tsx';
import { useAppearance } from './use-appearance.ts';
import { useDocumentTitle } from './use-document-title.ts';

// Bingkai portal: satu header dan isi halaman. Portal baru punya dua halaman, jadi menunya ada di header, bukan di
// samping. Klinik aktif tampil di kanan atas, seperti penunjuk organisasi di pusat admin Microsoft 365.
export function PortalLayout(): ReactNode {
    const { data: me } = useSuspenseQuery(meQuery);
    const queryClient = useQueryClient();
    const { resolvedAppearance, updateAppearance } = useAppearance();
    useDocumentTitle('Portal klinik');
    const shownName = me.name ?? me.email ?? 'Akun Anda';
    const themeLabel =
        resolvedAppearance === 'dark'
            ? 'Gunakan tema terang'
            : 'Gunakan tema gelap';

    const logout = async () => {
        try {
            await api.logout();
        } catch (caught) {
            toast.error(errorText(caught, 'Belum berhasil keluar.'));
            return;
        }
        queryClient.clear();
        // Muat ulang penuh supaya tidak ada data sesi sebelumnya yang tertinggal di layar.
        window.location.assign('/login');
    };

    return (
        <div className="flex h-svh min-h-0 min-w-[320px] flex-col overflow-hidden bg-muted/30 p-2">
            <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
                <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3 py-1.5 sm:px-4">
                    <Button variant="ghost" size="icon" asChild>
                        <Link to="/" aria-label="Beranda" title="Beranda">
                            <House />
                        </Link>
                    </Button>
                    <nav className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" asChild>
                            <Link to="/">Lingkungan</Link>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                            <Link to="/members">Anggota</Link>
                        </Button>
                    </nav>
                    <div className="ml-auto flex items-center gap-1">
                        <TenantSwitcher me={me} />
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={themeLabel}
                            title={themeLabel}
                            onClick={() =>
                                updateAppearance(
                                    resolvedAppearance === 'dark'
                                        ? 'light'
                                        : 'dark',
                                )
                            }
                        >
                            {resolvedAppearance === 'dark' ? <Sun /> : <Moon />}
                        </Button>
                        <div className="mx-2 hidden h-6 w-px bg-border sm:block" />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="rounded-full"
                                    aria-label="Buka menu profil"
                                >
                                    <Avatar>
                                        <AvatarFallback>
                                            {initials(shownName)}
                                        </AvatarFallback>
                                    </Avatar>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                className="min-w-56 rounded-lg"
                                align="end"
                            >
                                <DropdownMenuLabel className="font-normal">
                                    <div className="grid text-sm leading-tight">
                                        <span className="truncate font-medium">
                                            {shownName}
                                        </span>
                                        {me.email && me.email !== shownName && (
                                            <span className="truncate text-xs text-muted-foreground">
                                                {me.email}
                                            </span>
                                        )}
                                    </div>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={() => void logout()}
                                >
                                    <LogOut className="mr-2" />
                                    Keluar
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </header>
                <div
                    data-shell-page-content=""
                    className="relative isolate min-h-0 min-w-0 flex-1 overflow-auto bg-muted/30 has-[[data-layout=full-height]]:overflow-hidden"
                >
                    <Outlet />
                </div>
            </div>
        </div>
    );
}
