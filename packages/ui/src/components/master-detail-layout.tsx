import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
import type { GroupImperativeHandle, Layout } from 'react-resizable-panels';
import { cn } from '../utils';
import { Button } from './button';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from './resizable';

const WIDE_QUERY = '(min-width: 1280px)';
function subscribeToWidth(onChange: () => void) {
    const query = window.matchMedia(WIDE_QUERY);
    query.addEventListener('change', onChange);

    return () => query.removeEventListener('change', onChange);
}
function getWideSnapshot() {
    return window.matchMedia(WIDE_QUERY).matches;
}

/**
 * Komposisi Resizable untuk master-detail: batas lebar, divider polos, dan satu panel
 * pada layar kecil dipakai sama oleh semua halaman. Kedua panel tetap mounted agar
 * kembali ke daftar tidak membuang draft/scroll. Pemanggil memiliki pilihan dan izin edit.
 */
function MasterDetailLayout({
    list,
    detailOpen,
    onDetailOpenChange,
    children,
    className,
    ...props
}: React.ComponentPropsWithoutRef<'div'> & {
    list: React.ReactNode;
    detailOpen: boolean;
    onDetailOpenChange: (open: boolean) => void;
}) {
    const wide = React.useSyncExternalStore(
        subscribeToWidth,
        getWideSnapshot,
        () => false,
    );
    const id = React.useId();
    const listId = `${id}-list`;
    const detailId = `${id}-detail`;
    const groupRef = React.useRef<GroupImperativeHandle>(null);
    const desktopLayout = React.useRef<Layout>({
        [listId]: 25,
        [detailId]: 75,
    });
    React.useLayoutEffect(() => {
        groupRef.current?.setLayout(
            wide
                ? desktopLayout.current
                : {
                      [listId]: detailOpen ? 0 : 100,
                      [detailId]: detailOpen ? 100 : 0,
                  },
        );
    }, [wide, detailOpen, listId, detailId]);

    return (
        <div
            {...props}
            data-slot="master-detail-layout"
            className={cn(
                'flex h-full min-h-0 min-w-0 flex-1 flex-col',
                className,
            )}
        >
            {detailOpen && (
                <div className="shrink-0 border-b px-4 py-2 xl:hidden">
                    <Button
                        variant="outline"
                        onClick={() => onDetailOpenChange(false)}
                    >
                        <ArrowLeft className="size-4" />
                        Daftar
                    </Button>
                </div>
            )}
            <ResizablePanelGroup
                orientation="horizontal"
                groupRef={groupRef}
                disabled={!wide}
                className="min-h-0 min-w-0 flex-1"
                onLayoutChanged={(layout, { isUserInteraction }) => {
                    if (wide && isUserInteraction) {
                        desktopLayout.current = layout;
                    }
                }}
            >
                <ResizablePanel
                    id={listId}
                    defaultSize="25%"
                    minSize={wide ? 240 : 0}
                    maxSize={wide ? 480 : '100%'}
                    inert={!wide && detailOpen}
                    className="flex h-full min-h-0 min-w-0 flex-col"
                    style={{ overflow: 'hidden' }}
                >
                    {list}
                </ResizablePanel>
                <ResizableHandle
                    className="hidden xl:flex"
                    aria-label="Ubah lebar daftar dan detail"
                    title="Geser untuk mengatur lebar panel"
                />
                <ResizablePanel
                    id={detailId}
                    defaultSize="75%"
                    minSize={wide ? 560 : 0}
                    inert={!wide && !detailOpen}
                    className="flex h-full min-h-0 min-w-0 flex-col"
                    style={{ overflow: 'hidden' }}
                >
                    {children}
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}

export { MasterDetailLayout };
