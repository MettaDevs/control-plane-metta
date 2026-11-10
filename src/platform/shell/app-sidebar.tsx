import { Button } from '@control-plane-metta/ui/button';
import { Sidebar, useSidebar } from '@control-plane-metta/ui/sidebar';
import { cn } from '@control-plane-metta/ui/utils';
import { useLocation } from '@tanstack/react-router';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useState } from 'react';
import { navigation, type NavigationGroup } from './navigation.ts';
import { ShellLink } from './shell-link.tsx';

type NavigationItem = NavigationGroup['items'][number];

// Rail kiri dan submenu, disalin dari bingkai layar operations-metta. Kelompok dan halamannya dari `navigation.ts`.
export function AppSidebar() {
    const { open, setOpen, isMobile, setOpenMobile } = useSidebar();
    const location = useLocation();
    const url = location.href;
    const path = location.pathname;
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [pinnedId, setPinnedId] = useState<string | null>(null);
    const [previousUrl, setPreviousUrl] = useState(url);

    if (previousUrl !== url) {
        setPreviousUrl(url);
        setPreviewId(null);
        setPinnedId(null);
    }

    // Halaman record (`/sites/<id>`) tidak ada di menu, jadi ia ikut kelompok yang alamatnya mengawali alamat halaman.
    const selectedGroup =
        navigation.find((group) =>
            group.items.some((item) => path === item.href.split('?')[0]),
        ) ??
        navigation.find((group) => path.startsWith(`${group.href}/`)) ??
        navigation[0];
    const isItemActive = (item: NavigationItem) =>
        url === item.href || (!item.href.includes('?') && path === item.href);
    const displayedGroup =
        navigation.find((group) => group.id === previewId) ??
        (open
            ? navigation.find((group) => group.id === pinnedId)
            : undefined) ??
        selectedGroup;
    const showItems = isMobile || open || previewId !== null;

    return (
        <Sidebar
            collapsible="icon"
            className="z-30 border-r border-sidebar-border bg-sidebar"
            onMouseLeave={() => setPreviewId(null)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                    setPreviewId(null);
            }}
            onKeyDown={(event) => {
                if (
                    event.key === 'Escape' &&
                    event.currentTarget.contains(event.target as Node)
                ) {
                    setPreviewId(null);
                    if (isMobile) setOpenMobile(false);
                    else setOpen(false);
                }
            }}
        >
            <div className="relative flex h-full w-full">
                <aside className="flex h-full w-(--sidebar-width-icon) shrink-0 flex-col items-center border-r border-sidebar-border">
                    <nav
                        aria-label="Menu utama"
                        className="flex min-h-0 w-full flex-1 flex-col gap-1 overflow-y-auto px-0.5 py-2 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-sidebar-foreground/40 [&::-webkit-scrollbar-thumb]:bg-clip-content"
                    >
                        {navigation.map((group) => {
                            const Icon = group.icon;
                            const selected = selectedGroup?.id === group.id;
                            const previewed =
                                previewId === group.id && !selected;
                            return (
                                <ShellLink
                                    key={group.id}
                                    href={group.href}
                                    onMouseEnter={() => setPreviewId(group.id)}
                                    onFocus={() => setPreviewId(group.id)}
                                    onClick={() => {
                                        if (isMobile) setOpenMobile(false);
                                    }}
                                    aria-current={selected ? 'page' : undefined}
                                    className={cn(
                                        'flex min-h-11 min-w-0 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1 text-center text-[10px] font-normal text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&_svg]:size-4',
                                        selected && 'text-sidebar-foreground',
                                        previewed &&
                                            'bg-sidebar-accent text-sidebar-accent-foreground',
                                    )}
                                >
                                    <Icon
                                        className={cn(
                                            'box-content rounded-md border border-transparent p-1',
                                            selected &&
                                                'border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground',
                                            previewed &&
                                                'border-sidebar-accent-foreground/30',
                                        )}
                                    />
                                    <span className="w-full min-w-0 leading-tight break-words whitespace-normal">
                                        {group.label}
                                    </span>
                                </ShellLink>
                            );
                        })}
                    </nav>
                </aside>

                {displayedGroup && showItems && (
                    <nav
                        className={cn(
                            'flex min-h-0 w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))] shrink-0 flex-col bg-sidebar',
                            !isMobile &&
                                !open &&
                                'absolute inset-y-0 left-(--sidebar-width-icon) border-r border-sidebar-border shadow-lg',
                        )}
                        aria-label={`Menu ${displayedGroup.label}`}
                    >
                        <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2">
                            <h2 className="min-w-0 text-[13px] font-semibold break-words">
                                {displayedGroup.label}
                            </h2>
                            <Button
                                variant={isMobile || open ? 'ghost' : 'default'}
                                size="icon-xs"
                                aria-label={
                                    isMobile
                                        ? 'Tutup menu'
                                        : open
                                          ? 'Ciutkan menu'
                                          : 'Sematkan menu'
                                }
                                aria-expanded={isMobile || open}
                                onClick={() => {
                                    setPreviewId(
                                        open ? displayedGroup.id : null,
                                    );
                                    if (isMobile) {
                                        setOpenMobile(false);
                                    } else {
                                        if (!open)
                                            setPinnedId(displayedGroup.id);
                                        setOpen(!open);
                                    }
                                }}
                            >
                                {isMobile || open ? (
                                    <ChevronsLeft />
                                ) : (
                                    <ChevronsRight />
                                )}
                            </Button>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
                            {displayedGroup.items.map((item) => (
                                <ShellLink
                                    key={item.id}
                                    href={item.href}
                                    onClick={() => {
                                        // Desktop mempertahankan menu hover selama URL tujuan belum terpasang.
                                        if (isMobile) {
                                            setPreviewId(null);
                                            setOpenMobile(false);
                                        }
                                    }}
                                    aria-current={
                                        isItemActive(item) ? 'page' : undefined
                                    }
                                    className={cn(
                                        'flex min-h-8 shrink-0 items-center gap-2 rounded-md px-2 py-1 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring',
                                        isItemActive(item) &&
                                            'bg-sidebar-primary/15 text-sidebar-primary ring-1 ring-sidebar-primary/30 ring-inset hover:bg-sidebar-primary/20 hover:text-sidebar-primary',
                                    )}
                                >
                                    <span className="min-w-0 break-words whitespace-normal">
                                        {item.label}
                                    </span>
                                </ShellLink>
                            ))}
                        </div>
                    </nav>
                )}
            </div>
        </Sidebar>
    );
}
