import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';
import { cn } from '../utils';
import { ActionButton } from './action-button';
import { Button } from './button';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxCollection,
    ComboboxTrigger,
} from './combobox';
import { DataTable, DataTableText } from './data-table';
import type { DataTableColumn } from './data-table';
import { FieldHint } from './field';
import {
    InlineLookupListDialog,
    InlineLookupDetailsDialog,
} from './inline-lookup-dialogs';
import { InputGroupButton } from './input-group';
import { matchesRecordSearch } from './record-search';
import { TableCell, TableRow } from './table';
import {
    lookupComparator,
    useInlineLookupData,
} from './use-inline-lookup-data';
import type { LookupLoader } from './use-inline-lookup-data';
export type { LookupLoader } from './use-inline-lookup-data';

export type InlineLookupProps<T> = {
    items?: T[];
    loadItems?: LookupLoader<T>;
    /** Lookup memakai scroll bertahap, tidak menyediakan navigasi halaman. */
    pagination?: never;
    page?: never;
    onPageChange?: never;
    displayValue?: string;
    onQueryChange?: (query: string) => void;
    columns: DataTableColumn<T>[];
    value: T | null;
    onValueChange: (item: T) => void;
    getItemValue: (item: T) => string;
    getItemLabel: (item: T) => string;
    getSearchText?: (item: T) => string;
    label: string;
    required?: boolean;
    hint?: React.ReactNode;
    placeholder?: string;
    emptyMessage?: string;
    disabled?: boolean;
    inputRef?: React.RefObject<HTMLInputElement | null>;
    portalContainer?: React.ComponentProps<typeof ComboboxContent>['container'];
    popupClassName?: string;
    showDetails?: boolean;
    showFullList?: boolean;
    onCreate?: () => void;
    onDetails?: (item: T) => void;
    onFullList?: () => void;
};

/** Lookup bertabel dari playground: pencarian di field, kolom SDK, dan aksi opsional.
 * Pemanggil menyediakan data, izin, dan dialog bisnis; query tidak mengubah pilihan. */
export function InlineLookup<T>({
    items = [],
    loadItems,
    displayValue,
    onQueryChange,
    columns,
    value,
    onValueChange,
    getItemValue,
    getItemLabel,
    getSearchText = getItemLabel,
    label,
    required = false,
    hint,
    placeholder = 'Cari pilihan…',
    emptyMessage = 'Pilihan tidak ditemukan.',
    disabled = false,
    inputRef: providedInputRef,
    portalContainer,
    popupClassName,
    showDetails = true,
    showFullList = true,
    onCreate,
    onDetails,
    onFullList,
}: InlineLookupProps<T>) {
    const inputId = React.useId();
    const localInputRef = React.useRef<HTMLInputElement>(null);
    const inputRef = providedInputRef ?? localInputRef;
    const anchorRef = React.useRef<HTMLDivElement>(null);
    const [query, setQuery] = React.useState<string | undefined>(undefined);
    const [open, setOpen] = React.useState(false);
    const [listOpen, setListOpen] = React.useState(false);
    const [listQuery, setListQuery] = React.useState('');
    const [detailsItem, setDetailsItem] = React.useState<T | null>(null);
    const [highlighted, setHighlighted] = React.useState<T | null>(null);
    const [sort, setSort] = React.useState<{
        columnId: string;
        direction: 'asc' | 'desc';
    } | null>(null);
    const data = useInlineLookupData({
        items,
        loadItems,
        query: listOpen ? listQuery : (query ?? ''),
        active: open || listOpen,
        getItemValue,
        getSearchText,
        compareItems: lookupComparator(columns, sort),
    });
    const tableColumns = loadItems
        ? columns.map((column) => ({ ...column, sortValue: undefined }))
        : columns;
    const sortedItems = data.items;
    const searchQuery = (query ?? '').trim();
    const matchesSearch = (item: T) =>
        Boolean(loadItems) ||
        matchesRecordSearch(query ?? '', getSearchText(item));
    const highlightedTarget =
        highlighted === null
            ? null
            : data.items.find(
                  (item) =>
                      getItemValue(item) === getItemValue(highlighted) &&
                      matchesSearch(item),
              );
    const detailTarget =
        highlightedTarget ??
        (value !== null && matchesSearch(value) ? value : null);
    const closeForAction = () => {
        setOpen(false);
        setQuery(undefined);
        setHighlighted(null);
    };

    const restoreFocus = () =>
        requestAnimationFrame(() => inputRef.current?.focus());
    const openDetails = (item: T) => {
        if (onDetails) {
            data.invalidate();
            onDetails(item);
        } else {
            setDetailsItem(item);
        }
    };

    return (
        <>
            <div className="w-full min-w-0">
                <div className="min-w-0">
                    <Combobox
                        items={sortedItems}
                        value={value}
                        open={open}
                        disabled={disabled}
                        inputValue={
                            query ??
                            (value === null
                                ? (displayValue ?? '')
                                : getItemLabel(value))
                        }
                        onItemHighlighted={(item, details) => {
                            if (
                                item !== null &&
                                item !== undefined &&
                                (details.reason !== 'none' ||
                                    searchQuery !== '' ||
                                    value === null)
                            ) {
                                setHighlighted(item);
                            }
                        }}
                        onInputValueChange={(next, details) => {
                            if (details.reason === 'input-change') {
                                setQuery(next);
                                onQueryChange?.(next);
                                setHighlighted(null);
                            }
                        }}
                        onOpenChange={(nextOpen) => {
                            setOpen(nextOpen);
                            setHighlighted(null);

                            if (!nextOpen) {
                                setQuery(undefined);
                            }
                        }}
                        onValueChange={(next, details) => {
                            if (
                                next === null ||
                                next === undefined ||
                                details.reason === 'input-change' ||
                                details.reason === 'input-clear'
                            ) {
                                return;
                            }

                            onValueChange(next);
                            setQuery(undefined);
                            setHighlighted(null);
                        }}
                        itemToStringLabel={getItemLabel}
                        itemToStringValue={getItemValue}
                        isItemEqualToValue={(item, selected) =>
                            getItemValue(item) === getItemValue(selected)
                        }
                        filter={null}
                        autoHighlight
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <div ref={anchorRef} className="min-w-0 flex-1">
                                <ComboboxInput
                                    label={label}
                                    required={required}
                                    id={inputId}
                                    ref={inputRef}
                                    placeholder={placeholder}
                                    disabled={disabled}
                                    showTrigger={false}
                                    onBlur={() => {
                                        if (!open) {
                                            setQuery(undefined);
                                        }
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            setQuery(undefined);
                                            setHighlighted(null);
                                        }
                                    }}
                                >
                                    <ComboboxTrigger
                                        aria-label={`Tampilkan pilihan ${label.toLowerCase()}`}
                                        render={
                                            <InputGroupButton
                                                variant="ghost"
                                                size="icon-xs"
                                                disabled={disabled}
                                            />
                                        }
                                    />
                                </ComboboxInput>
                            </div>
                            {hint && (
                                <FieldHint
                                    hint={hint}
                                    side="right"
                                    className="inline-flex shrink-0"
                                >
                                    <button
                                        type="button"
                                        aria-label={`Lihat penjelasan ${label.toLowerCase()}`}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        <CircleAlert className="size-4" />
                                    </button>
                                </FieldHint>
                            )}
                        </div>
                        <ComboboxContent
                            container={portalContainer}
                            anchor={anchorRef}
                            className={cn(
                                'flex max-h-[min(24rem,var(--available-height))] w-[36rem] flex-col',
                                popupClassName,
                            )}
                        >
                            <ComboboxPrimitive.List
                                aria-busy={data.loading}
                                className="flex max-h-[min(18rem,calc(var(--available-height)-3.5rem))] min-h-0 flex-col overflow-hidden"
                                onScrollCapture={data.onScrollCapture}
                            >
                                <DataTable
                                    columns={tableColumns}
                                    data={sortedItems}
                                    getRowKey={getItemValue}
                                    showRowNumbers={false}
                                    scrollMode="viewport"
                                    sort={sort}
                                    onSortChange={setSort}
                                    renderRows={() => (
                                        <ComboboxCollection>
                                            {(item: T) => (
                                                <ComboboxPrimitive.Item
                                                    key={getItemValue(item)}
                                                    value={item}
                                                    render={<TableRow />}
                                                    className="cursor-default outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:bg-accent/50"
                                                >
                                                    {columns.map((column) => (
                                                        <TableCell
                                                            key={column.id}
                                                        >
                                                            <DataTableText>
                                                                {column.cell(
                                                                    item,
                                                                )}
                                                            </DataTableText>
                                                        </TableCell>
                                                    ))}
                                                </ComboboxPrimitive.Item>
                                            )}
                                        </ComboboxCollection>
                                    )}
                                />
                                {!data.loading && !data.error && (
                                    <ComboboxEmpty>
                                        {emptyMessage}
                                    </ComboboxEmpty>
                                )}
                            </ComboboxPrimitive.List>
                            {data.loading && (
                                <p
                                    role="status"
                                    className="px-3 py-2 text-sm text-muted-foreground"
                                >
                                    Memuat pilihan…
                                </p>
                            )}
                            {data.error && (
                                <div
                                    role="alert"
                                    className="px-3 py-2 text-sm text-destructive"
                                >
                                    {data.error}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={data.retry}
                                    >
                                        Coba lagi
                                    </Button>
                                </div>
                            )}
                            {(onCreate || showDetails || showFullList) && (
                                <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-t p-2">
                                    {onCreate && (
                                        <ActionButton
                                            action="create"
                                            onClick={() => {
                                                closeForAction();
                                                data.invalidate();
                                                onCreate();
                                            }}
                                        />
                                    )}
                                    <div className="ml-auto flex flex-wrap gap-1">
                                        {showDetails && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={detailTarget === null}
                                                onClick={() => {
                                                    if (detailTarget !== null) {
                                                        closeForAction();
                                                        openDetails(
                                                            detailTarget,
                                                        );
                                                    }
                                                }}
                                            >
                                                Detail
                                            </Button>
                                        )}
                                        {showFullList && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    closeForAction();

                                                    if (onFullList) {
                                                        onFullList();
                                                    } else {
                                                        setListQuery(
                                                            query ?? '',
                                                        );
                                                        setListOpen(true);
                                                    }
                                                }}
                                            >
                                                Daftar lengkap
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </ComboboxContent>
                    </Combobox>
                </div>
            </div>
            {listOpen && (
                <InlineLookupListDialog
                    items={data.items}
                    columns={tableColumns}
                    search={listQuery}
                    onSearchChange={setListQuery}
                    loading={data.loading}
                    error={data.error}
                    onRetry={data.retry}
                    onScrollCapture={data.onScrollCapture}
                    sort={sort}
                    onSortChange={setSort}
                    value={value}
                    label={label}
                    emptyMessage={emptyMessage}
                    getItemValue={getItemValue}
                    onDetails={showDetails ? openDetails : undefined}
                    onClose={() => {
                        setListOpen(false);
                        restoreFocus();
                    }}
                    onChoose={(item) => {
                        onValueChange(item);
                        setListOpen(false);
                        restoreFocus();
                    }}
                />
            )}
            {detailsItem !== null && (
                <InlineLookupDetailsDialog
                    item={
                        data.items.find(
                            (item) =>
                                getItemValue(item) ===
                                getItemValue(detailsItem),
                        ) ?? detailsItem
                    }
                    columns={columns}
                    title={getItemLabel(detailsItem)}
                    onClose={() => {
                        setDetailsItem(null);

                        if (!listOpen) {
                            restoreFocus();
                        }
                    }}
                />
            )}
        </>
    );
}
