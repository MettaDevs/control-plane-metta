import { ChevronDown, Filter, Pin, PinOff, Search } from 'lucide-react';
import * as React from 'react';

import { cn } from '../utils';
import { Button } from './button';
import { ContextualTitle } from './contextual-title';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from './dropdown-menu';
import { Input } from './input';
import { Popover, PopoverAnchor, PopoverContent } from './popover';
import { SEARCH_MAX_LENGTH } from './record-search';
import { Separator } from './separator';

export type RibbonState =
    { kind: 'closed' } | { kind: 'floating' | 'pinned'; groupId: string };
type RibbonEvent =
    { type: 'select'; groupId: string } | { type: 'pin' | 'unpin' | 'dismiss' };

/** Sematan mempertahankan baris pada layout; dismiss hanya menutup baris melayang. */
export function changeRibbonState(
    state: RibbonState,
    event: RibbonEvent,
): RibbonState {
    if (event.type === 'select') {
        if (state.kind === 'pinned') {
            return { kind: 'pinned', groupId: event.groupId };
        }

        return state.kind === 'floating' && state.groupId === event.groupId
            ? { kind: 'closed' }
            : { kind: 'floating', groupId: event.groupId };
    }

    if (state.kind === 'closed') {
        return state;
    }

    if (event.type === 'pin') {
        return { kind: 'pinned', groupId: state.groupId };
    }

    if (event.type === 'unpin') {
        return { kind: 'floating', groupId: state.groupId };
    }

    return state.kind === 'floating' ? { kind: 'closed' } : state;
}

const preferenceEvent = 'apperp:record-toolbar-preference';
function subscribePreference(notify: () => void) {
    window.addEventListener('storage', notify);
    window.addEventListener(preferenceEvent, notify);

    return () => {
        window.removeEventListener('storage', notify);
        window.removeEventListener(preferenceEvent, notify);
    };
}
function readPreference(
    key?: string,
): 'empty' | 'pinned' | 'floating' | 'unavailable' {
    if (!key) {
        return 'empty';
    }

    try {
        const saved = window.localStorage.getItem(
            `apperp:record-toolbar:${key}`,
        );

        return saved === 'pinned' || saved === 'floating' ? saved : 'empty';
    } catch {
        return 'unavailable';
    }
}

function writePreference(key: string | undefined, pinned: boolean) {
    if (!key) {
        return;
    }

    try {
        window.localStorage.setItem(
            `apperp:record-toolbar:${key}`,
            pinned ? 'pinned' : 'floating',
        );
        window.dispatchEvent(new Event(preferenceEvent));
    } catch {
        /* Preferensi opsional; toolbar tetap dapat dipakai bila storage dibatasi. */
    }
}

export type RecordActionBarProps = React.ComponentProps<'div'> & {
    title?: React.ReactNode;
    titleHint?: React.ReactNode;
    trailing?: React.ReactNode;
    feedback?: React.ReactNode;
    mode?: 'ribbon' | 'dropdown';
    defaultPinned?: boolean;
    /** Pemanggil menyertakan identitas pengguna dan halaman; tanpa key tidak ada penyimpanan. */
    preferenceKey?: string;
    portalContainer?: React.ComponentProps<
        typeof PopoverContent
    >['portalContainer'];
    search?: {
        value: string;
        onValueChange: (value: string) => void;
        label?: string;
        placeholder?: string;
        maxLength?: number;
        onSubmit?: () => void;
    };
    filter?: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        active?: boolean;
        label?: string;
        controls: string;
    };
    groups?: readonly {
        id: string;
        label: string;
        actions: readonly {
            id: string;
            label: string;
            icon?: React.ReactNode;
            disabled?: boolean;
            title?: string;
            onSelect: () => void;
        }[];
    }[];
};

function ToolbarSeparator() {
    return (
        <Separator
            orientation="vertical"
            decorative={false}
            className="mx-1 self-center data-[orientation=vertical]:h-5"
        />
    );
}

/** Perintah, ribbon, dan dropdown memakai definisi aksi yang sama; penyimpanan tetap milik form. */
function RecordActionBar({
    title,
    titleHint,
    trailing,
    feedback,
    groups,
    mode = 'ribbon',
    defaultPinned = false,
    preferenceKey,
    portalContainer,
    search,
    filter,
    className,
    children,
    ...props
}: RecordActionBarProps) {
    const storedPreference = React.useSyncExternalStore(
        subscribePreference,
        React.useCallback(() => readPreference(preferenceKey), [preferenceKey]),
        () => 'empty' as const,
    );
    const [interaction, setInteraction] = React.useState<{
        scope: string | undefined;
        state: RibbonState;
    } | null>(null);
    const initialPinned =
        storedPreference === 'pinned' ||
        ((storedPreference === 'empty' || storedPreference === 'unavailable') &&
            defaultPinned);
    const state: RibbonState =
        interaction && interaction.scope === preferenceKey
            ? interaction.state
            : initialPinned && groups?.[0]
              ? { kind: 'pinned', groupId: groups[0].id }
              : { kind: 'closed' };
    const activeGroup =
        state.kind !== 'closed'
            ? groups?.find((group) => group.id === state.groupId)
            : undefined;
    const floating =
        mode === 'ribbon' && state.kind === 'floating' && !!activeGroup;
    const pinned =
        mode === 'ribbon' && state.kind === 'pinned' && !!activeGroup;
    const barId = React.useId();
    const ribbonId = `${barId}-ribbon`;
    const rowRef = React.useRef<HTMLDivElement>(null);
    const groupButtons = React.useRef(new Map<string, HTMLButtonElement>());
    const lastGroup = React.useRef<string | null>(null);
    const restoreGroupFocus = React.useRef(true);
    const pinButton = React.useRef<HTMLButtonElement>(null);
    const [searchOpen, setSearchOpen] = React.useState(false);
    const searchInput = React.useRef<HTMLInputElement>(null);
    const searchButton = React.useRef<HTMLButtonElement>(null);
    const searchVisible = searchOpen || Boolean(search?.value);
    const hasGroups = !!groups?.length;
    const hasCommands = Boolean(children);
    const dispatch = (event: RibbonEvent) => {
        if (event.type === 'select') {
            lastGroup.current = event.groupId;
            restoreGroupFocus.current = true;
        }

        const next = changeRibbonState(state, event);
        setInteraction({ scope: preferenceKey, state: next });

        if (event.type === 'pin' || event.type === 'unpin') {
            writePreference(preferenceKey, next.kind === 'pinned');
        }
    };
    const strip = activeGroup ? (
        <div
            id={ribbonId}
            data-slot="record-action-ribbon"
            data-command-bar=""
            data-pinned={pinned || undefined}
            role="group"
            aria-label={`Perintah ${activeGroup.label}`}
            className="flex w-full flex-wrap items-center gap-1 px-2 py-1"
        >
            {activeGroup.actions.map((action) => (
                <Button
                    key={action.id}
                    type="button"
                    variant="ghost"
                    disabled={action.disabled}
                    title={action.title}
                    onClick={() => {
                        action.onSelect();

                        if (!pinned) {
                            dispatch({ type: 'dismiss' });
                        }
                    }}
                >
                    {action.icon}
                    {action.label}
                </Button>
            ))}
            <Button
                ref={pinButton}
                type="button"
                variant="ghost"
                size="icon-sm"
                className="ms-auto"
                aria-label={
                    pinned ? 'Lepas sematan toolbar' : 'Sematkan toolbar'
                }
                title={pinned ? 'Lepas sematan toolbar' : 'Sematkan toolbar'}
                onClick={() => dispatch({ type: pinned ? 'unpin' : 'pin' })}
            >
                {pinned ? (
                    <PinOff aria-hidden="true" />
                ) : (
                    <Pin aria-hidden="true" />
                )}
            </Button>
        </div>
    ) : null;

    return (
        <div
            data-slot="record-action-bar"
            data-command-bar=""
            className={cn(
                'sticky top-0 z-20 flex shrink-0 flex-col border-b bg-background px-4 py-1',
                className,
            )}
            {...props}
        >
            <Popover
                open={floating}
                onOpenChange={(open) => {
                    if (!open) {
                        dispatch({ type: 'dismiss' });
                    }
                }}
            >
                <PopoverAnchor asChild>
                    <div
                        ref={rowRef}
                        className="flex w-full flex-wrap items-center gap-1"
                    >
                        {title ? (
                            <>
                                <span className="mr-1 min-w-0 text-sm font-semibold">
                                    {titleHint ? (
                                        <ContextualTitle hint={titleHint}>
                                            {title}
                                        </ContextualTitle>
                                    ) : (
                                        title
                                    )}
                                </span>
                                {(search ||
                                    hasCommands ||
                                    hasGroups ||
                                    trailing ||
                                    filter) && <ToolbarSeparator />}
                            </>
                        ) : null}
                        {search && (
                            <>
                                <div
                                    data-slot="record-toolbar-search"
                                    className="flex items-center gap-1"
                                    onBlur={(event) => {
                                        if (
                                            !event.currentTarget.contains(
                                                event.relatedTarget,
                                            ) &&
                                            !search.value
                                        ) {
                                            setSearchOpen(false);
                                        }
                                    }}
                                >
                                    <Button
                                        ref={searchButton}
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={search.label ?? 'Cari'}
                                        title={search.label ?? 'Cari'}
                                        aria-expanded={searchVisible}
                                        aria-controls={`${barId}-search`}
                                        onClick={() => {
                                            if (
                                                searchVisible &&
                                                !search.value
                                            ) {
                                                setSearchOpen(false);
                                            } else {
                                                setSearchOpen(true);
                                                requestAnimationFrame(() =>
                                                    searchInput.current?.focus(),
                                                );
                                            }
                                        }}
                                    >
                                        <Search aria-hidden="true" />
                                    </Button>
                                    {searchVisible && (
                                        <Input
                                            ref={searchInput}
                                            id={`${barId}-search`}
                                            type="search"
                                            maxLength={
                                                search.maxLength ??
                                                SEARCH_MAX_LENGTH
                                            }
                                            className="w-56"
                                            aria-label={search.label ?? 'Cari'}
                                            placeholder={
                                                search.placeholder ?? 'Cari...'
                                            }
                                            value={search.value}
                                            onChange={(event) =>
                                                search.onValueChange(
                                                    event.target.value,
                                                )
                                            }
                                            onKeyDown={(event) => {
                                                if (
                                                    event.key === 'Enter' &&
                                                    !event.nativeEvent
                                                        .isComposing &&
                                                    search.onSubmit
                                                ) {
                                                    event.preventDefault();
                                                    search.onSubmit();
                                                }

                                                if (event.key === 'Escape') {
                                                    event.preventDefault();
                                                    event.stopPropagation();

                                                    if (!search.value) {
                                                        setSearchOpen(false);
                                                        searchButton.current?.focus();
                                                    }
                                                }
                                            }}
                                        />
                                    )}
                                </div>
                                {(hasCommands || hasGroups) && (
                                    <ToolbarSeparator />
                                )}
                            </>
                        )}
                        {children}
                        {hasCommands && hasGroups && <ToolbarSeparator />}
                        {groups?.map((group) =>
                            mode === 'dropdown' ? (
                                <DropdownMenu key={group.id} modal={false}>
                                    <DropdownMenuTrigger asChild>
                                        <Button type="button" variant="ghost">
                                            {group.label}
                                            <ChevronDown aria-hidden="true" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                        {group.actions.map((action) => (
                                            <DropdownMenuItem
                                                key={action.id}
                                                disabled={action.disabled}
                                                title={action.title}
                                                onSelect={action.onSelect}
                                            >
                                                {action.icon}
                                                {action.label}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <Button
                                    key={group.id}
                                    ref={(node) => {
                                        if (node) {
                                            groupButtons.current.set(
                                                group.id,
                                                node,
                                            );
                                        } else {
                                            groupButtons.current.delete(
                                                group.id,
                                            );
                                        }
                                    }}
                                    type="button"
                                    variant="ghost"
                                    data-action-group={group.id}
                                    aria-expanded={activeGroup?.id === group.id}
                                    aria-controls={ribbonId}
                                    className={
                                        activeGroup?.id === group.id
                                            ? 'text-primary underline underline-offset-4'
                                            : undefined
                                    }
                                    onClick={() =>
                                        dispatch({
                                            type: 'select',
                                            groupId: group.id,
                                        })
                                    }
                                >
                                    {group.label}
                                </Button>
                            ),
                        )}
                        {trailing || filter ? (
                            <div className="ms-auto flex flex-wrap items-center gap-1">
                                <ToolbarSeparator />
                                {filter && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={
                                            filter.label ??
                                            (filter.open
                                                ? 'Sembunyikan filter'
                                                : 'Tampilkan filter')
                                        }
                                        title={filter.label ?? 'Filter'}
                                        aria-expanded={filter.open}
                                        aria-controls={filter.controls}
                                        data-filter-active={
                                            filter.active || undefined
                                        }
                                        onClick={() =>
                                            filter.onOpenChange(!filter.open)
                                        }
                                    >
                                        <Filter
                                            aria-hidden="true"
                                            className={
                                                filter.active
                                                    ? 'fill-primary/20'
                                                    : undefined
                                            }
                                        />
                                    </Button>
                                )}
                                {trailing}
                            </div>
                        ) : null}
                    </div>
                </PopoverAnchor>
                <PopoverContent
                    portalContainer={portalContainer}
                    align="start"
                    sideOffset={0}
                    className="w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)] rounded-none p-0"
                    onInteractOutside={(event) => {
                        if (
                            event.target instanceof Element &&
                            rowRef.current?.contains(event.target) &&
                            event.target.closest('[data-action-group]')
                        ) {
                            event.preventDefault();
                        } else {
                            restoreGroupFocus.current = false;
                        }
                    }}
                    onEscapeKeyDown={() => {
                        restoreGroupFocus.current = true;
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();

                        if (state.kind === 'pinned') {
                            pinButton.current?.focus();
                        } else if (
                            restoreGroupFocus.current &&
                            lastGroup.current
                        ) {
                            groupButtons.current
                                .get(lastGroup.current)
                                ?.focus();
                        }
                    }}
                >
                    {floating ? strip : null}
                </PopoverContent>
            </Popover>
            {pinned && <div className="mt-1 border-t">{strip}</div>}

            {feedback ? <div className="w-full py-2">{feedback}</div> : null}
        </div>
    );
}

export { RecordActionBar };
