import { Avatar, AvatarFallback } from '@control-plane-metta/ui/avatar';
import { Button } from '@control-plane-metta/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@control-plane-metta/ui/dropdown-menu';
import { SidebarTrigger } from '@control-plane-metta/ui/sidebar';
import { cn } from '@control-plane-metta/ui/utils';
import { Link } from '@tanstack/react-router';
import { House, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import type { Operator } from './api.ts';
import { homePath } from './navigation.ts';
import { useAppearance } from './use-appearance.ts';
import { SsoLinkDialog, useSsoLinkNotice } from './sso-link.tsx';
import { initials } from './initials.ts';
import { UserMenuContent } from './user-menu.tsx';

// Header bingkai, disalin dari operations-metta tanpa pencarian halaman dan pemilih ruang kerja: konsol baru punya dua
// halaman dan tidak punya ruang kerja. Tautan beranda memakai ikon umum, bukan logo merek.
export function AppSidebarHeader({
    operator,
    sso,
    isScrolled = false,
}: {
    operator: Operator;
    sso: { linked: boolean } | null;
    isScrolled?: boolean;
}) {
    const [linking, setLinking] = useState(false);
    useSsoLinkNotice();
    const { resolvedAppearance, updateAppearance } = useAppearance();
    const themeLabel =
        resolvedAppearance === 'dark'
            ? 'Gunakan tema terang'
            : 'Gunakan tema gelap';

    return (
        <header
            className={cn(
                'sticky top-0 z-20 min-h-12 shrink-0 border-b bg-background transition-[border-radius,box-shadow] duration-200',
                isScrolled ? 'rounded-none shadow-sm' : 'rounded-t-2xl',
            )}
        >
            <div className="flex min-h-12 min-w-0 flex-wrap items-center gap-2 px-3 py-1.5 sm:gap-3 sm:px-4">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <Button variant="ghost" size="icon" asChild>
                    <Link to={homePath} aria-label="Beranda" title="Beranda">
                        <House />
                    </Link>
                </Button>

                <div className="ml-auto flex items-center gap-1">
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
                                data-test="header-profile-menu"
                            >
                                <Avatar>
                                    <AvatarFallback>
                                        {initials(operator.name)}
                                    </AvatarFallback>
                                </Avatar>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            className="min-w-56 rounded-lg"
                            align="end"
                        >
                            <UserMenuContent
                                operator={operator}
                                sso={sso}
                                onLinkSso={() => setLinking(true)}
                            />
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            {linking && <SsoLinkDialog onOpenChange={setLinking} />}
        </header>
    );
}
