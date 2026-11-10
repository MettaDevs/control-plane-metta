import {
    Info,
    Maximize2,
    Minimize2,
    PanelRightClose,
    PanelRightOpen,
    Paperclip,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils';
import { Button } from './button';
import { Card, CardContent, CardHeader } from './card';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from './collapsible';
import { Separator } from './separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const DEFAULT_WIDTH = 384;
const MIN_WIDTH = 288;

/** Wadah FactBox bersama. Grid menjaga form tetap terpasang saat panel diubah ukurannya atau layar menyempit. */
export function FactBox({
    children,
    details,
    attachments,
    attachmentCount,
    defaultOpen = true,
    className,
    fillHeight = false,
    toolbarContainer,
}: {
    children: ReactNode;
    details: ReactNode;
    attachments: ReactNode;
    attachmentCount?: number | null;
    defaultOpen?: boolean;
    className?: string;
    /** Daftar memakai seluruh tinggi Shell; tabel dan panel menggulir secara terpisah. */
    fillHeight?: boolean;
    /** undefined mempertahankan kontrol lokal; null menunggu host toolbar tersedia. */
    toolbarContainer?: HTMLElement | null;
}) {
    const externalToolbar = toolbarContainer !== undefined;
    const [open, setOpen] = useState(defaultOpen);
    const [tab, setTab] = useState('details');
    const [width, setWidth] = useState(DEFAULT_WIDTH);
    const [maxWidth, setMaxWidth] = useState(DEFAULT_WIDTH);
    const layout = useRef<HTMLDivElement>(null);
    const drag = useRef<{ pointerId: number; x: number; width: number } | null>(
        null,
    );
    const panelId = useId();
    const panelWidth = Math.min(width, maxWidth);
    const expanded = panelWidth === maxWidth && maxWidth > DEFAULT_WIDTH;

    useEffect(() => {
        const node = layout.current;

        if (!node) {
            return;
        }

        const observer = new ResizeObserver(() => {
            // Form utama tetap punya ruang; pada ponsel pembatas disembunyikan dan panel ditumpuk.
            setMaxWidth(Math.max(MIN_WIDTH, node.clientWidth - 356));
        });
        observer.observe(node);

        return () => observer.disconnect();
    }, []);

    function resize(nextWidth: number) {
        setWidth(Math.min(maxWidth, Math.max(MIN_WIDTH, nextWidth)));
    }

    const controls = (
        <div
            className="flex items-center justify-end gap-1"
            data-slot="fact-box-controls"
        >
            {open && (
                <Button
                    type="button"
                    variant="ghost"
                    size={externalToolbar ? 'icon-sm' : 'icon'}
                    className="hidden xl:inline-flex"
                    disabled={maxWidth <= DEFAULT_WIDTH}
                    aria-label={
                        expanded
                            ? 'Kembalikan lebar panel'
                            : 'Perlebar panel detail dan lampiran'
                    }
                    title={
                        expanded
                            ? 'Kembalikan lebar panel'
                            : 'Perlebar panel detail dan lampiran'
                    }
                    onClick={() => resize(expanded ? DEFAULT_WIDTH : maxWidth)}
                >
                    {expanded ? <Minimize2 /> : <Maximize2 />}
                </Button>
            )}
            <CollapsibleTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size={externalToolbar ? 'icon-sm' : 'icon'}
                    aria-label={
                        open
                            ? 'Sembunyikan detail dan lampiran'
                            : 'Tampilkan detail dan lampiran'
                    }
                    title={
                        open
                            ? 'Sembunyikan detail dan lampiran'
                            : 'Tampilkan detail dan lampiran'
                    }
                >
                    {open ? <PanelRightClose /> : <PanelRightOpen />}
                </Button>
            </CollapsibleTrigger>
        </div>
    );

    return (
        <Collapsible
            ref={layout}
            open={open}
            onOpenChange={setOpen}
            data-slot="fact-box-layout"
            style={{ '--fact-box-width': `${panelWidth}px` } as CSSProperties}
            className={cn(
                'grid min-w-0 items-start gap-3',
                open
                    ? 'xl:grid-cols-[minmax(0,1fr)_1px_minmax(0,var(--fact-box-width))]'
                    : externalToolbar
                      ? 'xl:grid-cols-1'
                      : 'xl:grid-cols-[minmax(0,1fr)_2.5rem]',
                className,
                fillHeight &&
                    'h-full min-h-0 overflow-y-auto xl:items-stretch xl:gap-x-0 xl:overflow-hidden',
            )}
        >
            <div
                className={cn(
                    'min-w-0 space-y-4',
                    fillHeight && 'flex min-h-0 flex-col overflow-hidden',
                )}
            >
                {children}
            </div>
            {open && (
                <Separator
                    decorative={false}
                    orientation="vertical"
                    tabIndex={0}
                    aria-label="Ubah lebar panel detail dan lampiran"
                    aria-orientation="vertical"
                    aria-controls={panelId}
                    aria-valuemin={MIN_WIDTH}
                    aria-valuemax={maxWidth}
                    aria-valuenow={panelWidth}
                    aria-valuetext={`${Math.round(panelWidth)} piksel`}
                    title="Tarik untuk mengubah lebar. Tombol panah kiri/kanan juga bisa digunakan. Klik dua kali untuk mengembalikan lebar."
                    className="relative hidden touch-none self-stretch select-none after:absolute after:-inset-x-1 after:inset-y-0 focus-visible:outline-2 focus-visible:outline-ring xl:block xl:cursor-col-resize"
                    onDoubleClick={() => resize(DEFAULT_WIDTH)}
                    onPointerDown={(event) => {
                        if (event.button !== 0) {
                            return;
                        }

                        event.preventDefault();
                        // Pembatas setinggi form: fokus biasa menggulir layar ke tengahnya.
                        event.currentTarget.focus({ preventScroll: true });
                        drag.current = {
                            pointerId: event.pointerId,
                            x: event.clientX,
                            width: panelWidth,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        const current = drag.current;

                        if (current?.pointerId === event.pointerId) {
                            resize(current.width + current.x - event.clientX);
                        }
                    }}
                    onPointerUp={() => {
                        drag.current = null;
                    }}
                    onPointerCancel={() => {
                        const current = drag.current;

                        if (current) {
                            resize(current.width);
                        }

                        drag.current = null;
                    }}
                    onLostPointerCapture={() => {
                        drag.current = null;
                    }}
                    onKeyDown={(event) => {
                        const next =
                            event.key === 'ArrowLeft'
                                ? panelWidth + 20
                                : event.key === 'ArrowRight'
                                  ? panelWidth - 20
                                  : event.key === 'Home'
                                    ? MIN_WIDTH
                                    : event.key === 'End'
                                      ? maxWidth
                                      : null;

                        if (next !== null) {
                            event.preventDefault();
                            resize(next);
                        }
                    }}
                />
            )}
            <aside
                id={panelId}
                aria-label="Detail dan lampiran"
                className={cn(
                    'min-w-0 xl:sticky xl:top-0',
                    fillHeight && 'min-h-0 xl:overflow-y-auto',
                    fillHeight && open && 'xl:ps-3',
                    externalToolbar && !open && 'hidden',
                )}
            >
                {externalToolbar
                    ? toolbarContainer &&
                      createPortal(controls, toolbarContainer)
                    : controls}
                <CollapsibleContent>
                    <Tabs value={tab} onValueChange={setTab}>
                        <Card>
                            <CardHeader>
                                <TabsList
                                    variant="line"
                                    aria-label="Informasi pendamping"
                                >
                                    <TabsTrigger value="details">
                                        <Info />
                                        Detail
                                    </TabsTrigger>
                                    <TabsTrigger value="attachments">
                                        <Paperclip />
                                        Lampiran
                                        {attachmentCount != null
                                            ? ` (${attachmentCount})`
                                            : ''}
                                    </TabsTrigger>
                                </TabsList>
                            </CardHeader>
                            <CardContent>
                                <TabsContent value="details">
                                    {details}
                                </TabsContent>
                                <TabsContent
                                    value="attachments"
                                    forceMount
                                    className="data-[state=inactive]:hidden"
                                >
                                    {attachments}
                                </TabsContent>
                            </CardContent>
                        </Card>
                    </Tabs>
                </CollapsibleContent>
            </aside>
        </Collapsible>
    );
}
