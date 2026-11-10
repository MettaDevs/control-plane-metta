import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Maximize2,
    Minimize2,
    Plus,
    Pencil,
    Share,
    Trash2,
    ExternalLink,
    Info,
    X,
} from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';
import { toast } from 'sonner';
import { DocumentLineCellContext } from '../document-line-context';
import { createPageDialogRecordStore } from '../lib/page-dialog-record';
import {
    getPageDialogRevision,
    getPageDialogStack,
    registerPageDialog,
    subscribePageDialogs,
} from '../lib/page-dialog-stack';
import { cn } from '../utils';
import { Badge } from './badge';
import { Button } from './button';
import { ContextualTitle } from './contextual-title';
import {
    DialogAction as PageDialogAction,
    DialogBody as PageDialogBody,
    DialogDescription as PageDialogDescription,
    DialogFooter as PageDialogFooter,
    DialogTitle,
    DialogToolbar as PageDialogToolbar,
} from './dialog';
import { FieldHint } from './field';

const popupEscapes = new WeakSet<KeyboardEvent>();
const serverSnapshot = () => 0;
const activeElement = () =>
    document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

type PageContext = {
    count: number;
    active: boolean;
    expanded: boolean;
    setExpanded: (expanded: boolean) => void;
    busy: boolean;
    focusContent: () => void;
};
const PageDialogContext = React.createContext<PageContext | null>(null);

export type PageDialogRecord = {
    recordTitle?: React.ReactNode;
    onEdit?: () => void;
    onDelete?: () => void;
    editing?: boolean;
    recordUrl?: string;
    onShare?: () => void;
    mainNavigation?: React.ReactNode;
    secondaryNavigation?: React.ReactNode;
};
type RecordStore = ReturnType<
    typeof createPageDialogRecordStore<PageDialogRecord>
>;
const PageDialogRecordContext = React.createContext<RecordStore | null>(null);

export function usePageDialogRecord(
    record: PageDialogRecord | undefined,
): boolean {
    const store = React.useContext(PageDialogRecordContext);
    const [id] = React.useState(() => Symbol('page-dialog-record'));
    React.useLayoutEffect(() => {
        store?.set(id, record);
    });
    React.useLayoutEffect(() => () => store?.set(id, undefined), [store, id]);

    return store !== null;
}

export type PageDialogNavigation = {
    previous?: () => void;
    next?: () => void;
    previousDisabled?: boolean;
    nextDisabled?: boolean;
};

type PageDialogContentProps = Omit<
    React.ComponentPropsWithRef<typeof DialogPrimitive.Content>,
    'title'
> &
    PageDialogRecord & {
        title: React.ReactNode;
        titleHint?: React.ReactNode;
        description?: React.ReactNode;
        headerActions?: React.ReactNode;
        onNew?: () => void;
        navigation?: PageDialogNavigation;
        busy?: boolean;
        expanded?: boolean;
        defaultExpanded?: boolean;
        onExpandedChange?: (expanded: boolean) => void;
    };

/** Kartu/pemilih halaman memakai stack R&D; konfirmasi kecil tetap memakai Dialog. */
function PageDialog(
    props: Omit<React.ComponentProps<typeof DialogPrimitive.Root>, 'modal'>,
) {
    return <DialogPrimitive.Root {...props} modal={false} />;
}

function PageDialogContent({
    children,
    expanded,
    defaultExpanded = false,
    onExpandedChange,
    ...props
}: PageDialogContentProps) {
    const anchorRef = React.useRef<HTMLSpanElement>(null);
    const [host, setHost] = React.useState<HTMLElement | null>(null);
    const [internalExpanded, setInternalExpanded] =
        React.useState(defaultExpanded);
    React.useLayoutEffect(() => {
        setHost(
            anchorRef.current
                ?.closest('[data-shell-content]')
                ?.querySelector<HTMLElement>('[data-shell-overlay-host]') ??
                document.body,
        );
    }, []);
    const setExpanded = (next: boolean) => {
        if (expanded === undefined) {
            setInternalExpanded(next);
        }

        onExpandedChange?.(next);
    };

    return (
        <>
            <span hidden ref={anchorRef} />
            <DialogPrimitive.Portal container={host}>
                {host && (
                    <PageDialogSurface
                        {...props}
                        host={host}
                        expanded={expanded ?? internalExpanded}
                        setExpanded={setExpanded}
                    >
                        <DocumentLineCellContext.Provider value={null}>
                            {children}
                        </DocumentLineCellContext.Provider>
                    </PageDialogSurface>
                )}
            </DialogPrimitive.Portal>
        </>
    );
}

function PageDialogSurface({
    host,
    children,
    ref: forwardedRef,
    className,
    expanded,
    setExpanded,
    onEscapeKeyDown,
    onInteractOutside,
    onCloseAutoFocus,
    style,
    title,
    titleHint,
    description,
    headerActions,
    onNew,
    navigation,
    busy = false,
    recordTitle,
    onEdit,
    onDelete,
    editing,
    recordUrl,
    onShare,
    mainNavigation,
    secondaryNavigation,
    ...props
}: Omit<PageDialogContentProps, 'defaultExpanded' | 'onExpandedChange'> & {
    host: HTMLElement;
    expanded: boolean;
    setExpanded: (expanded: boolean) => void;
}) {
    const [id] = React.useState(() => Symbol('page-dialog'));
    const [recordStore] = React.useState(() =>
        createPageDialogRecordStore<PageDialogRecord>(),
    );
    const nodeRef = React.useRef<HTMLDivElement>(null);
    React.useSyncExternalStore(
        subscribePageDialogs,
        getPageDialogRevision,
        serverSnapshot,
    );
    const group = getPageDialogStack(host);
    const index = group.findIndex((item) => item.id === id);
    const depth = index === -1 ? 0 : group.length - index - 1;
    const active = depth === 0;
    const count = index === -1 ? group.length + 1 : group.length;
    React.useLayoutEffect(() => {
        if (!nodeRef.current) {
            return;
        }

        return registerPageDialog({
            id,
            host,
            node: nodeRef.current,
            opener: activeElement(),
        });
    }, [host, id]);
    React.useLayoutEffect(() => {
        // Popup dapat menutup di capture handler-nya sebelum handler Radix halaman.
        const rememberPopup = (event: KeyboardEvent) => {
            if (
                active &&
                event.key === 'Escape' &&
                nodeRef.current?.querySelector(
                    '[role="combobox"][aria-expanded="true"]',
                )
            ) {
                popupEscapes.add(event);
            }
        };
        const ownerWindow = host.ownerDocument.defaultView;
        ownerWindow?.addEventListener('keydown', rememberPopup, true);

        return () =>
            ownerWindow?.removeEventListener('keydown', rememberPopup, true);
    }, [active, host]);

    return (
        <PageDialogRecordContext.Provider value={recordStore}>
            <PageDialogContext.Provider
                value={{
                    count,
                    active,
                    expanded,
                    setExpanded,
                    busy,
                    focusContent: () =>
                        nodeRef.current
                            ?.querySelector<HTMLElement>(
                                '[data-page-dialog-body], [data-slot="dialog-body"], main',
                            )
                            ?.scrollTo({ top: 0 }),
                }}
            >
                {active && (
                    <div
                        className="core-page-dialog-backdrop"
                        data-shell={host !== document.body}
                        aria-hidden="true"
                    />
                )}
                <DialogPrimitive.Content
                    {...props}
                    {...(!description && !props['aria-describedby']
                        ? { 'aria-describedby': undefined }
                        : {})}
                    ref={nodeRef}
                    className={cn('core-page-dialog', className)}
                    data-slot="page-dialog-content"
                    data-shell={host !== document.body}
                    data-active={active}
                    data-expanded={expanded}
                    aria-hidden={!active || undefined}
                    inert={!active || undefined}
                    style={
                        {
                            ...style,
                            '--stack-depth': depth,
                            zIndex: 31 + Math.max(index, 0),
                        } as React.CSSProperties
                    }
                    onInteractOutside={(event) => {
                        onInteractOutside?.(event);
                        event.preventDefault();
                    }}
                    onEscapeKeyDown={(event) => {
                        onEscapeKeyDown?.(event);

                        if (
                            busy ||
                            !active ||
                            !nodeRef.current?.contains(
                                event.target as Node | null,
                            ) ||
                            popupEscapes.has(event) ||
                            nodeRef.current?.querySelector(
                                '[role="combobox"][aria-expanded="true"]',
                            )
                        ) {
                            event.preventDefault();
                        }
                    }}
                    onCloseAutoFocus={(event) => {
                        onCloseAutoFocus?.(event);
                        event.preventDefault();
                    }}
                >
                    <div
                        ref={forwardedRef}
                        className="core-page-dialog-contents"
                        data-slot="page-dialog-contents"
                    >
                        <PageDialogHeader
                            title={title}
                            titleHint={titleHint}
                            description={description}
                            defaults={{
                                recordTitle,
                                onEdit,
                                onDelete,
                                editing,
                                recordUrl,
                                onShare,
                                mainNavigation,
                                secondaryNavigation,
                            }}
                            actions={headerActions}
                            onNew={onNew}
                            navigation={navigation}
                        />
                        {children}
                    </div>
                    {active && navigation && (
                        <RecordNavigationButtons
                            navigation={navigation}
                            busy={busy}
                            edges
                        />
                    )}
                    {!active && (
                        <div
                            className="core-page-dialog-inactive"
                            data-slot="page-dialog-inactive"
                            aria-hidden="true"
                        />
                    )}
                </DialogPrimitive.Content>
            </PageDialogContext.Provider>
        </PageDialogRecordContext.Provider>
    );
}

function PageDialogHeader({
    title,
    titleHint,
    description,
    defaults,
    actions,
    onNew,
    navigation,
}: {
    title: React.ReactNode;
    titleHint?: React.ReactNode;
    description?: React.ReactNode;
    defaults: PageDialogRecord;
    actions?: React.ReactNode;
    onNew?: () => void;
    navigation?: PageDialogNavigation;
}) {
    const page = React.useContext(PageDialogContext);
    const store = React.useContext(PageDialogRecordContext)!;
    React.useSyncExternalStore(
        store.subscribe,
        store.getRevision,
        serverSnapshot,
    );
    const record = { ...defaults, ...store.getRecord() };
    const shareRecord = async () => {
        if (record.onShare) {
            record.onShare();

            return;
        }

        if (!record.recordUrl) {
            return;
        }

        try {
            await navigator.clipboard.writeText(
                new URL(record.recordUrl, window.location.href).href,
            );
            toast.success('Tautan disalin.');
        } catch {
            toast.error('Tautan belum dapat disalin.');
        }
    };

    if (!page) {
        throw new Error('PageDialogHeader requires PageDialogContent.');
    }

    const help = description ? (
        <FieldHint hint={description}>
            <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Bantuan halaman"
            >
                <Info />
            </Button>
        </FieldHint>
    ) : null;
    const mainNavigation =
        record.mainNavigation === undefined && record.recordTitle ? (
            <Button
                type="button"
                variant="ghost"
                size="command"
                aria-current="page"
                className="rounded-none border-b border-primary text-primary"
                onClick={page.focusContent}
            >
                Beranda
            </Button>
        ) : (
            record.mainNavigation
        );

    return (
        <div
            className="core-page-dialog-heading"
            data-slot="page-dialog-heading"
        >
            <div className="core-page-dialog-header">
                <DialogPrimitive.Close asChild>
                    <Button
                        type="button"
                        data-page-dialog-back
                        className="rounded-full bg-accent/60 text-accent-foreground"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Kembali ke halaman sebelumnya"
                        title="Kembali (Esc)"
                        disabled={page.busy}
                    >
                        <ArrowLeft />
                    </Button>
                </DialogPrimitive.Close>
                <PageDialogTitle>
                    {titleHint ? (
                        <ContextualTitle hint={titleHint}>
                            {title}
                        </ContextualTitle>
                    ) : (
                        title
                    )}
                </PageDialogTitle>
                <div
                    className="core-page-dialog-record-actions"
                    role="group"
                    aria-label="Aksi record"
                >
                    {(record.onEdit || record.editing) && (
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Ubah"
                            title="Ubah"
                            aria-pressed={record.editing}
                            className={
                                record.editing
                                    ? 'rounded-full border border-primary disabled:opacity-100'
                                    : undefined
                            }
                            disabled={
                                page.busy || record.editing || !record.onEdit
                            }
                            onClick={record.onEdit}
                        >
                            <Pencil />
                        </Button>
                    )}
                    {(record.onShare || record.recordUrl) && (
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Bagikan"
                            title="Salin tautan"
                            disabled={page.busy}
                            onClick={() => void shareRecord()}
                        >
                            <Share />
                        </Button>
                    )}
                    {onNew && (
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            disabled={page.busy}
                            onClick={onNew}
                            aria-label="Baru"
                            title="Baru"
                        >
                            <Plus />
                        </Button>
                    )}
                    {record.onDelete && (
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Delete"
                            title="Delete"
                            disabled={page.busy}
                            onClick={record.onDelete}
                        >
                            <Trash2 />
                        </Button>
                    )}
                </div>
                <div className="core-page-dialog-window-actions">
                    {page.count > 1 && (
                        <Badge
                            variant="outline"
                            className="shrink-0 text-xs"
                            role="status"
                            aria-label={page.count + ' halaman terbuka'}
                            title={page.count + ' halaman terbuka'}
                        >
                            {page.count}
                        </Badge>
                    )}
                    {actions}
                    {!mainNavigation && help}
                    {record.recordUrl && (
                        <Button asChild size="icon-sm" variant="ghost">
                            <a
                                href={record.recordUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Buka di tab baru"
                                title="Buka di tab baru"
                            >
                                <ExternalLink />
                            </a>
                        </Button>
                    )}
                    {navigation && (
                        <RecordNavigationButtons
                            navigation={navigation}
                            busy={page.busy}
                        />
                    )}
                    <Button
                        type="button"
                        className="core-page-dialog-expand"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={
                            page.expanded
                                ? 'Kembalikan ukuran halaman'
                                : 'Perbesar halaman'
                        }
                        onClick={() => page.setExpanded(!page.expanded)}
                    >
                        {page.expanded ? <Minimize2 /> : <Maximize2 />}
                    </Button>
                    <DialogPrimitive.Close asChild>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Tutup halaman"
                            disabled={page.busy}
                        >
                            <X />
                        </Button>
                    </DialogPrimitive.Close>
                </div>
            </div>
            {record.recordTitle && (
                <h2
                    className="core-page-dialog-record-title"
                    data-slot="page-dialog-record-title"
                >
                    {record.recordTitle}
                </h2>
            )}
            {description && (
                <PageDialogDescription className="sr-only">
                    {description}
                </PageDialogDescription>
            )}
            {mainNavigation && (
                <nav
                    className="core-page-dialog-main-navigation"
                    aria-label="Navigasi utama kartu"
                >
                    {mainNavigation}
                    {help && <span className="ms-auto">{help}</span>}
                </nav>
            )}
            {record.secondaryNavigation && (
                <div
                    className="core-page-dialog-secondary-navigation"
                    role="group"
                    aria-label="Aksi bagian kartu"
                >
                    {record.secondaryNavigation}
                </div>
            )}
        </div>
    );
}

function RecordNavigationButtons({
    navigation,
    busy,
    edges = false,
}: {
    navigation: PageDialogNavigation;
    busy: boolean;
    edges?: boolean;
}) {
    return (
        <div
            className={
                edges
                    ? 'core-page-dialog-edge-navigation'
                    : 'core-page-dialog-header-navigation'
            }
        >
            <Button
                type="button"
                variant={edges ? 'secondary' : 'ghost'}
                size="icon-sm"
                className={edges ? 'core-page-dialog-previous' : undefined}
                aria-label="Data sebelumnya"
                disabled={
                    busy || !navigation.previous || navigation.previousDisabled
                }
                onClick={navigation.previous}
            >
                <ChevronLeft />
            </Button>
            <Button
                type="button"
                variant={edges ? 'secondary' : 'ghost'}
                size="icon-sm"
                className={edges ? 'core-page-dialog-next' : undefined}
                aria-label="Data berikutnya"
                disabled={busy || !navigation.next || navigation.nextDisabled}
                onClick={navigation.next}
            >
                <ChevronRight />
            </Button>
        </div>
    );
}

function PageDialogTitle({
    className,
    ...props
}: React.ComponentProps<typeof DialogTitle>) {
    return (
        <DialogTitle
            className={cn(
                'text-xs leading-5 font-normal text-muted-foreground',
                className,
            )}
            {...props}
        />
    );
}

const PageDialogClose = DialogPrimitive.Close;
const PageDialogTrigger = DialogPrimitive.Trigger;
export {
    PageDialog,
    PageDialogContent,
    PageDialogBody,
    PageDialogFooter,
    PageDialogToolbar,
    PageDialogAction,
    PageDialogClose,
    PageDialogTrigger,
};
