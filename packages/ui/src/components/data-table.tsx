import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    ArrowUpDown,
    Ellipsis,
    Menu,
    Filter,
    Plus,
} from 'lucide-react';
import * as React from 'react';
import { DocumentLineCellContext } from '../document-line-context';
import type { DocumentLinePortal } from '../document-line-context';

import { TableScrollContext } from '../table-scroll-context';
import { cn } from '../utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './dropdown-menu';
import { IncrementalListStatus } from './incremental-list-status';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from './table';

type SortValue = string | number;
type SortDirection = 'asc' | 'desc';
type DataTableSort = { columnId: string; direction: SortDirection };

type DataTableColumn<T> = {
    id: string;
    header: string;
    required?: boolean;
    cellMode?: 'form';
    description?: string;
    headerFilter?: React.ReactNode;
    filterActive?: boolean;
    headerActions?: { label: string; onSelect: () => void }[];
    cell: (row: T) => React.ReactNode;
    /** Kontrol form menyediakan ruang bagi floating label tanpa pemotongan teks sel. */
    content?: 'text' | 'control';
    sortValue?: (row: T) => SortValue;
    width?: number;
    minWidth?: number;
    align?: 'left' | 'center' | 'right';
};

type DataTableRowAction = {
    id: string;
    label: string;
    icon?: React.ReactNode;
    destructive?: boolean;
    separatorBefore?: boolean;
};

type DataTableSelection = {
    selectedKeys: readonly React.Key[];
    onSelectedKeysChange: (keys: React.Key[]) => void;
};

type UtilityWidths = { selection: number; rowNumbers: number; actions: number };

type DataTableProps<T> = {
    cellMode?: 'document' | 'form';
    cellPortalContainer?: DocumentLinePortal;
    serverSort?: boolean;
    /** Urutan server tidak boleh diurutkan ulang hanya pada batch yang sudah dimuat. */
    incremental?: {
        hasMore: boolean;
        loading: boolean;
        error: string;
        loadMore: () => void;
        retry: () => void;
    };
    columns: DataTableColumn<T>[];
    /** Baris hierarkis memakai header, ukuran kolom, dan scroll tabel yang sama. */
    renderRows?: () => React.ReactNode;
    /** Menu freeze hanya tersedia pada layar yang mengaktifkannya. */
    allowColumnFreeze?: boolean;
    showColumnMenu?: boolean;
    onResetColumns?: () => void;
    onResetFilters?: () => void;
    data: T[];
    getRowKey: (row: T) => React.Key;
    actions?: DataTableRowAction[];
    /** Aksi mengikuti izin tiap record; actions tetap menentukan kolom yang tersedia. */
    getRowActions?: (row: T) => DataTableRowAction[];
    getRowLabel?: (row: T) => string;
    onRowAction?: (actionId: string, row: T) => void;
    selection?: DataTableSelection;
    emptyMessage?: string;
    showRowNumbers?: boolean;
    className?: string;
    /** `viewport` mengisi ruang yang dibatasi halaman; `inline` mengikuti isi form/dialog. */
    scrollMode?: 'inline' | 'viewport';
    /**
     * Letak menu tiga titik. `inline` menaruhnya tepat setelah kolom pertama
     * seperti Business Central, sehingga tetap terjangkau pada tabel lebar tanpa
     * perlu menggulir ke kanan. `trailing` menaruhnya di kolom terakhir.
     */
    actionsPlacement?: 'inline' | 'trailing';
    /** Baris aktif ditandai panah pada kolom nomor, seperti penunjuk baris BC. */
    activeRowKey?: React.Key;
    /** Membuka baris memakai klik dua kali; pemilihan baris boleh memakai klik sekali. */
    rowActivation?: 'double-click' | 'single-click';
    onRowClick?: (row: T) => void;
    /** Baris kosong di bawah untuk menambah data, seperti Edit List BC. */
    onAddRow?: (columnId?: string) => void;
    addRowMode?: 'action' | 'cells';
    addRowLabel?: string;
    /**
     * Urutan yang dipegang layar, bila layar perlu mengetahuinya, misalnya untuk mengekspor daftar dengan
     * urutan yang sama dengan yang tampil. Tanpa `sort`, tabel memegang urutannya sendiri.
     */
    sort?: DataTableSort | null;
    /** Dipanggil setiap kali pengguna mengganti urutan kolom. */
    onSortChange?: (sort: DataTableSort | null) => void;
    pagination?: never;
    page?: never;
    onPageChange?: never;
};

/** Nilai satu baris; header dapat membungkus kata dengan `multiline`. */
function DataTableText({
    children,
    multiline = false,
}: {
    children: React.ReactNode;
    multiline?: boolean;
}) {
    if (typeof children !== 'string' && typeof children !== 'number') {
        return <>{children}</>;
    }

    if (!multiline) {
        return (
            <span className="block min-w-0 truncate" title={String(children)}>
                {children}
            </span>
        );
    }

    return (
        <span
            className="block min-w-0 whitespace-pre-line"
            title={String(children)}
        >
            {String(children)
                .split(/(\s+)/)
                .map((word, index) =>
                    /^\s+$/.test(word) ? (
                        word
                    ) : (
                        <span
                            key={index}
                            className="inline-block max-w-full truncate align-bottom"
                        >
                            {word}
                        </span>
                    ),
                )}
        </span>
    );
}

function DataTable<T>({
    cellMode = 'form',
    cellPortalContainer,
    columns,
    renderRows,
    allowColumnFreeze = false,
    showColumnMenu = false,
    onResetColumns,
    onResetFilters,
    data,
    getRowKey,
    actions = [],
    getRowActions,
    getRowLabel,
    onRowAction,
    selection,
    emptyMessage = 'No results.',
    showRowNumbers = true,
    className,
    scrollMode: requestedScrollMode,
    actionsPlacement = 'inline',
    activeRowKey,
    rowActivation = 'double-click',
    onRowClick,
    onAddRow,
    addRowMode = 'action',
    addRowLabel = 'Tambah',
    sort: controlledSort,
    onSortChange,
    incremental,
    serverSort = false,
}: DataTableProps<T>) {
    const [wrapHeaders, setWrapHeaders] = React.useState(true);
    const [frozenCount, setFrozenCount] = React.useState(0);
    const frozenLeft = (index: number) =>
        columns
            .slice(0, index)
            .reduce(
                (total, column) =>
                    total + (widths[column.id] ?? column.width ?? 160),
                (selection ? selectionWidth : 0) +
                    (showRowNumbers ? rowNumberWidth : 0) +
                    (hasInlineActions && index > 0 ? actionWidth : 0),
            );
    const inheritedScrollMode = React.useContext(TableScrollContext);
    const scrollMode = requestedScrollMode ?? inheritedScrollMode;
    const seamlessHeader = scrollMode === 'viewport' && cellMode !== 'document';
    const [internalSort, setSort] = React.useState<DataTableSort | null>(null);
    const sort = controlledSort === undefined ? internalSort : controlledSort;
    const [fixedSizing, setFixedSizing] = React.useState(false);
    const [widths, updateWidths] = React.useState<Record<string, number>>(() =>
        Object.fromEntries(
            columns.map((column) => [
                column.id,
                Math.max(column.width ?? 160, column.minWidth ?? 80),
            ]),
        ),
    );
    const setWidths = (next: React.SetStateAction<Record<string, number>>) => {
        updateWidths(next);
        setFixedSizing(true);
    };
    const tableRef = React.useRef<HTMLTableElement | null>(null);
    const [utilityWidths, setUtilityWidths] =
        React.useState<UtilityWidths | null>(null);
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const [resizeGuide, setResizeGuide] = React.useState<number | null>(null);
    const selectedKeys = new Set(selection?.selectedKeys);
    const resize = React.useRef<{
        columnId: string;
        nextColumnId: string | null;
        startX: number;
        startWidth: number;
        nextStartWidth: number;
        minWidth: number;
        nextMinWidth: number;
        measuredWidths: Record<string, number>;
        guideLeft: number;
        utilityWidths: UtilityWidths;
    } | null>(null);

    const measureWidths = () => {
        const headerCells = new Map(
            Array.from(
                tableRef.current?.querySelectorAll<HTMLTableCellElement>(
                    'thead th[data-column-id]',
                ) ?? [],
            ).map((cell) => [
                cell.dataset.columnId,
                cell.getBoundingClientRect().width,
            ]),
        );
        const measured = Object.fromEntries(
            columns.map((column) => [
                column.id,
                Math.max(
                    headerCells.get(column.id) ??
                        widths[column.id] ??
                        column.width ??
                        160,
                    column.minWidth ?? 80,
                ),
            ]),
        );

        return measured;
    };

    const resizedWidths = (
        current: NonNullable<typeof resize.current>,
        delta: number,
    ) => {
        return {
            ...current.measuredWidths,
            [current.columnId]: Math.max(
                current.startWidth + delta,
                current.minWidth,
            ),
        };
    };

    const measureUtilityWidths = (): UtilityWidths => ({
        selection:
            tableRef.current
                ?.querySelector('thead th[data-column-kind="selection"]')
                ?.getBoundingClientRect().width ?? 44,
        rowNumbers:
            tableRef.current
                ?.querySelector('thead th[data-column-kind="row-numbers"]')
                ?.getBoundingClientRect().width ?? 44,
        actions:
            tableRef.current
                ?.querySelector('thead th[data-column-kind="actions"]')
                ?.getBoundingClientRect().width ??
            (actionsPlacement === 'inline' ? 36 : 44),
    });

    const sortedData = React.useMemo(() => {
        if (!sort || incremental || serverSort) {
            return data;
        }

        const column = columns.find((item) => item.id === sort.columnId);

        if (!column?.sortValue) {
            return data;
        }

        return [...data].sort((left, right) => {
            const a = column.sortValue!(left);
            const b = column.sortValue!(right);
            const result =
                typeof a === 'number' && typeof b === 'number'
                    ? a - b
                    : String(a).localeCompare(String(b), undefined, {
                          numeric: true,
                          sensitivity: 'base',
                      });

            return sort.direction === 'asc' ? result : -result;
        });
    }, [columns, data, sort, incremental, serverSort]);

    const toggleSort = (columnId: string) => {
        const next: DataTableSort = {
            columnId,
            direction:
                sort?.columnId === columnId && sort.direction === 'asc'
                    ? 'desc'
                    : 'asc',
        };

        setSort(next);
        onSortChange?.(next);
    };

    const allRowsSelected =
        data.length > 0 &&
        data.every((row) => selectedKeys.has(getRowKey(row)));
    const someRowsSelected = data.some((row) =>
        selectedKeys.has(getRowKey(row)),
    );

    const toggleAllRows = () => {
        if (!selection) {
            return;
        }

        const next = new Set(selection.selectedKeys);
        data.forEach((row) => {
            const key = getRowKey(row);

            if (allRowsSelected) {
                next.delete(key);
            } else {
                next.add(key);
            }
        });
        selection.onSelectedKeysChange([...next]);
    };

    const hasInlineActions =
        actions.length > 0 && actionsPlacement === 'inline';
    const hasTrailingActions =
        actions.length > 0 && actionsPlacement === 'trailing';
    const selectionWidth = utilityWidths?.selection ?? 44;
    const rowNumberWidth = utilityWidths?.rowNumbers ?? 44;
    const actionWidth = utilityWidths?.actions ?? (hasInlineActions ? 36 : 44);
    const totalColumns =
        columns.length +
        (selection ? 1 : 0) +
        (showRowNumbers ? 1 : 0) +
        (actions.length > 0 ? 1 : 0);
    const actionsMenu = (row: T) => {
        const rowActions = getRowActions?.(row) ?? actions;

        if (!rowActions.length) {
            return null;
        }

        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={`Tindakan untuk ${getRowLabel?.(row) ?? 'baris'}`}
                        /* Membuka menu bukan mengklik baris. Tanpa ini, tabel yang memakai
             `onRowClick` ikut berpindah halaman begitu menunya dibuka, dan tindakan
             yang baru saja dipilih pengguna langsung ditimpa tujuan baris. */
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Ellipsis />
                    </Button>
                </DropdownMenuTrigger>
                {/* Menu ini diportal, tetapi peristiwa React tetap merambat lewat pohon komponen,
          bukan pohon DOM: tanpa penghenti di sini, memilih satu tindakan juga menghitung
          sebagai klik pada barisnya, dan tujuan baris menimpa tindakan yang dipilih. */}
                <DropdownMenuContent
                    align="start"
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                >
                    {rowActions.map((action) => (
                        <React.Fragment key={action.id}>
                            {action.separatorBefore && (
                                <DropdownMenuSeparator />
                            )}
                            <DropdownMenuItem
                                variant={
                                    action.destructive
                                        ? 'destructive'
                                        : 'default'
                                }
                                onSelect={() => onRowAction?.(action.id, row)}
                            >
                                {action.icon}
                                {action.label}
                            </DropdownMenuItem>
                        </React.Fragment>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        );
    };

    const activateRow = (
        event: React.MouseEvent<HTMLTableRowElement>,
        row: T,
    ) => {
        if (
            rowActivation === 'double-click' &&
            event.target instanceof Element &&
            event.target.closest(
                'a, button, input, textarea, select, [role="button"], [role="checkbox"], [role="combobox"], [contenteditable]',
            )
        ) {
            return;
        }

        onRowClick?.(row);
    };

    const renderRow = (row: T, index: number) => (
        <TableRow
            key={getRowKey(row)}
            data-row-key={String(getRowKey(row))}
            data-active={activeRowKey === getRowKey(row) ? '' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={
                onRowClick && rowActivation === 'single-click'
                    ? (event) => activateRow(event, row)
                    : undefined
            }
            onDoubleClick={
                onRowClick && rowActivation === 'double-click'
                    ? (event) => activateRow(event, row)
                    : undefined
            }
            onKeyDown={(event) => {
                if (
                    onRowClick &&
                    event.target === event.currentTarget &&
                    (event.key === 'Enter' || event.key === ' ')
                ) {
                    event.preventDefault();
                    onRowClick(row);
                }
            }}
            className={cn(
                'border-0 hover:bg-accent/40 data-active:bg-accent/60',
                onRowClick &&
                    'cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                selection && selectedKeys.has(getRowKey(row)) && 'bg-accent/40',
            )}
        >
            {selection && (
                /* Mencentang baris bukan membukanya; klik berhenti di sel ini. */
                <TableCell
                    className="h-9 border-b px-2 text-center"
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                >
                    <Checkbox
                        checked={selectedKeys.has(getRowKey(row))}
                        onCheckedChange={(checked) => {
                            const next = new Set(selection.selectedKeys);
                            const key = getRowKey(row);

                            if (checked) {
                                next.add(key);
                            } else {
                                next.delete(key);
                            }

                            selection.onSelectedKeysChange([...next]);
                        }}
                        aria-label={`Pilih ${getRowLabel?.(row) ?? 'baris'}`}
                    />
                </TableCell>
            )}
            {showRowNumbers && (
                <TableCell className="h-9 border-b px-2 text-center text-xs text-muted-foreground tabular-nums">
                    {activeRowKey === getRowKey(row) ? (
                        <ArrowRight className="mx-auto size-3.5 text-primary" />
                    ) : (
                        index + 1
                    )}
                </TableCell>
            )}
            {columns.map((column, columnIndex) => (
                <React.Fragment key={column.id}>
                    <TableCell
                        data-column-id={column.id}
                        ref={(cell) => {
                            if (cell) {
                                cell.title = cell.textContent ?? '';
                            }
                        }}
                        style={
                            allowColumnFreeze && columnIndex < frozenCount
                                ? {
                                      position: 'sticky',
                                      left: frozenLeft(columnIndex),
                                      zIndex: 10,
                                  }
                                : undefined
                        }
                        className={cn(
                            allowColumnFreeze &&
                                columnIndex < frozenCount &&
                                'bg-background',
                            'h-9 overflow-hidden border-b px-3 py-2 whitespace-nowrap',
                            column.align === 'center' && 'text-center',
                            column.align === 'right' && 'text-right',
                        )}
                    >
                        <div
                            data-cell-content={column.content ?? 'text'}
                            className={cn(
                                'min-w-0',
                                column.content === 'control'
                                    ? 'py-2 whitespace-normal'
                                    : 'truncate',
                            )}
                        >
                            <DocumentLineCellContext.Provider
                                value={
                                    cellMode === 'document'
                                        ? {
                                              compact:
                                                  column.cellMode !== 'form',
                                              label: column.header,
                                              rowNumber: index + 1,
                                              portalContainer:
                                                  cellPortalContainer,
                                          }
                                        : null
                                }
                            >
                                <DataTableText>
                                    {column.cell(row)}
                                </DataTableText>
                            </DocumentLineCellContext.Provider>
                        </div>
                    </TableCell>
                    {hasInlineActions && columnIndex === 0 && (
                        <TableCell className="h-9 border-b px-1 text-center">
                            {actionsMenu(row)}
                        </TableCell>
                    )}
                </React.Fragment>
            ))}
            {hasTrailingActions && (
                <TableCell className="h-9 border-b px-1 text-center">
                    {actionsMenu(row)}
                </TableCell>
            )}
        </TableRow>
    );

    return (
        <div
            ref={containerRef}
            data-slot="data-table"
            data-cell-mode={cellMode}
            data-seamless-header={seamlessHeader ? '' : undefined}
            className={cn(
                'relative overflow-hidden rounded-md border bg-background',
                seamlessHeader && 'rounded-none border-0 bg-transparent',
                scrollMode === 'viewport' &&
                    'flex h-full min-h-0 flex-1 flex-col',
                className,
            )}
        >
            <Table
                ref={tableRef}
                containerClassName={
                    scrollMode === 'viewport'
                        ? 'min-h-0 flex-1 overflow-auto'
                        : undefined
                }
                className="table-fixed border-separate border-spacing-0 leading-5"
                style={{
                    width:
                        fixedSizing || (allowColumnFreeze && frozenCount > 0)
                            ? columns.reduce(
                                  (total, column) =>
                                      total +
                                      (widths[column.id] ??
                                          column.width ??
                                          160),
                                  (selection ? selectionWidth : 0) +
                                      (showRowNumbers ? rowNumberWidth : 0) +
                                      (actions.length ? actionWidth : 0),
                              )
                            : '100%',
                    // Tabel tetap mengisi viewport setelah kolom diperkecil.
                    minWidth: `max(100%, ${columns.reduce(
                        (total, column) =>
                            total + (widths[column.id] ?? column.width ?? 160),
                        (selection ? selectionWidth : 0) +
                            (showRowNumbers ? rowNumberWidth : 0) +
                            (actions.length ? actionWidth : 0),
                    )}px)`,
                }}
            >
                <colgroup>
                    {selection && <col style={{ width: selectionWidth }} />}
                    {showRowNumbers && (
                        <col style={{ width: rowNumberWidth }} />
                    )}
                    {columns.map((column, columnIndex) => (
                        <React.Fragment key={column.id}>
                            <col
                                style={{
                                    width:
                                        widths[column.id] ??
                                        column.width ??
                                        160,
                                }}
                            />
                            {hasInlineActions && columnIndex === 0 && (
                                <col style={{ width: actionWidth }} />
                            )}
                        </React.Fragment>
                    ))}
                    {hasTrailingActions && (
                        <col style={{ width: actionWidth }} />
                    )}
                </colgroup>
                <TableHeader
                    className={cn(
                        '[&_tr]:border-0',
                        scrollMode === 'viewport' &&
                            'sticky top-0 z-10 bg-background',
                    )}
                >
                    <TableRow className="border-0 hover:bg-transparent">
                        {selection && (
                            <TableHead
                                data-column-kind="selection"
                                className="h-9 border-b bg-muted/70 px-2 text-center"
                            >
                                <Checkbox
                                    checked={
                                        allRowsSelected
                                            ? true
                                            : someRowsSelected
                                              ? 'indeterminate'
                                              : false
                                    }
                                    onCheckedChange={toggleAllRows}
                                    aria-label="Pilih semua baris"
                                />
                            </TableHead>
                        )}
                        {showRowNumbers && (
                            <TableHead
                                data-column-kind="row-numbers"
                                className="h-9 border-b bg-muted/70 px-2 text-center text-xs text-muted-foreground"
                            >
                                #
                            </TableHead>
                        )}
                        {columns.map((column, columnIndex) => {
                            const nextColumn = columns[columnIndex + 1];
                            const isSorted = sort?.columnId === column.id;
                            const SortIcon = !isSorted
                                ? ArrowUpDown
                                : sort.direction === 'asc'
                                  ? ArrowUp
                                  : ArrowDown;

                            return (
                                <React.Fragment key={column.id}>
                                    <TableHead
                                        data-column-id={column.id}
                                        style={
                                            allowColumnFreeze &&
                                            columns.indexOf(column) <
                                                frozenCount
                                                ? {
                                                      position: 'sticky',
                                                      left: frozenLeft(
                                                          columns.indexOf(
                                                              column,
                                                          ),
                                                      ),
                                                      zIndex: 30,
                                                  }
                                                : undefined
                                        }
                                        title={
                                            column.description ?? column.header
                                        }
                                        aria-sort={
                                            isSorted
                                                ? sort.direction === 'asc'
                                                    ? 'ascending'
                                                    : 'descending'
                                                : undefined
                                        }
                                        className={cn(
                                            'group relative h-9 overflow-visible border-b bg-muted/70 px-3 py-2 align-bottom text-xs font-normal whitespace-normal select-none last:border-r-0',
                                            allowColumnFreeze &&
                                                columns.indexOf(column) <
                                                    frozenCount &&
                                                'bg-muted',
                                            (showColumnMenu ||
                                                allowColumnFreeze ||
                                                column.headerFilter) &&
                                                'pr-12',
                                            column.align === 'center' &&
                                                'text-center',
                                            column.align === 'right' &&
                                                'text-right',
                                        )}
                                    >
                                        {column.sortValue ? (
                                            <button
                                                type="button"
                                                className={cn(
                                                    'inline-flex w-full min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                                    column.align === 'center' &&
                                                        'justify-center text-center',
                                                    column.align === 'right' &&
                                                        'justify-end text-right',
                                                )}
                                                onClick={() =>
                                                    toggleSort(column.id)
                                                }
                                                aria-label={`Sort by ${column.header}`}
                                            >
                                                <span
                                                    className={cn(
                                                        'min-w-0',
                                                        !seamlessHeader &&
                                                            'flex-1',
                                                    )}
                                                >
                                                    <span className="inline-flex min-w-0 items-baseline gap-1">
                                                        <DataTableText
                                                            multiline={
                                                                wrapHeaders
                                                            }
                                                        >
                                                            {column.header}
                                                        </DataTableText>
                                                        {column.required && (
                                                            <span
                                                                className="text-destructive"
                                                                aria-hidden="true"
                                                            >
                                                                *
                                                            </span>
                                                        )}
                                                    </span>
                                                </span>
                                                <SortIcon
                                                    className={cn(
                                                        'size-3.5 shrink-0 text-muted-foreground transition-opacity',
                                                        !isSorted &&
                                                            'opacity-0 group-focus-within:opacity-60 group-hover:opacity-60',
                                                    )}
                                                />
                                            </button>
                                        ) : (
                                            <span className="inline-flex min-w-0 items-baseline gap-1">
                                                <DataTableText
                                                    multiline={wrapHeaders}
                                                >
                                                    {column.header}
                                                </DataTableText>
                                                {column.required && (
                                                    <span
                                                        className="text-destructive"
                                                        aria-hidden="true"
                                                    >
                                                        *
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                        {(allowColumnFreeze ||
                                            showColumnMenu ||
                                            column.headerActions?.length) && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        aria-label={`Menu kolom ${column.header}`}
                                                        className="absolute top-1 right-7 z-10 rounded bg-muted p-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                                                    >
                                                        <Menu className="size-3.5" />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent>
                                                    {allowColumnFreeze && (
                                                        <>
                                                            {' '}
                                                            <DropdownMenuItem
                                                                onClick={() =>
                                                                    setFrozenCount(
                                                                        columns.indexOf(
                                                                            column,
                                                                        ) + 1,
                                                                    )
                                                                }
                                                            >
                                                                Freeze sampai
                                                                kolom ini
                                                            </DropdownMenuItem>
                                                        </>
                                                    )}{' '}
                                                    {allowColumnFreeze &&
                                                        frozenCount > 0 && (
                                                            <DropdownMenuItem
                                                                onClick={() =>
                                                                    setFrozenCount(
                                                                        0,
                                                                    )
                                                                }
                                                            >
                                                                Lepas freeze
                                                            </DropdownMenuItem>
                                                        )}
                                                    {column.headerActions?.map(
                                                        (action) => (
                                                            <DropdownMenuItem
                                                                key={
                                                                    action.label
                                                                }
                                                                onClick={
                                                                    action.onSelect
                                                                }
                                                            >
                                                                {action.label}
                                                            </DropdownMenuItem>
                                                        ),
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setWidths(
                                                                Object.fromEntries(
                                                                    columns.map(
                                                                        (
                                                                            item,
                                                                        ) => [
                                                                            item.id,
                                                                            Math.max(
                                                                                item.width ??
                                                                                    160,
                                                                                item.minWidth ??
                                                                                    80,
                                                                            ),
                                                                        ],
                                                                    ),
                                                                ),
                                                            );
                                                            setFrozenCount(0);
                                                            onResetColumns?.();
                                                        }}
                                                    >
                                                        Reset columns
                                                    </DropdownMenuItem>
                                                    {onResetFilters && (
                                                        <DropdownMenuItem
                                                            onClick={
                                                                onResetFilters
                                                            }
                                                        >
                                                            Reset analysis
                                                            filters
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            const room =
                                                                containerRef
                                                                    .current
                                                                    ?.clientWidth ??
                                                                0;
                                                            const reserved =
                                                                (selection
                                                                    ? selectionWidth
                                                                    : 0) +
                                                                (showRowNumbers
                                                                    ? rowNumberWidth
                                                                    : 0) +
                                                                (actions.length
                                                                    ? actionWidth
                                                                    : 0);
                                                            setWidths(
                                                                Object.fromEntries(
                                                                    columns.map(
                                                                        (
                                                                            item,
                                                                        ) => [
                                                                            item.id,
                                                                            Math.max(
                                                                                item.minWidth ??
                                                                                    80,
                                                                                (room -
                                                                                    reserved) /
                                                                                    Math.max(
                                                                                        1,
                                                                                        columns.length,
                                                                                    ),
                                                                            ),
                                                                        ],
                                                                    ),
                                                                ),
                                                            );
                                                        }}
                                                    >
                                                        Autosize all columns to
                                                        fit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            setWrapHeaders(
                                                                (value) =>
                                                                    !value,
                                                            )
                                                        }
                                                    >
                                                        {wrapHeaders
                                                            ? 'Unwrap column headers'
                                                            : 'Wrap column headers'}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                        {column.headerFilter && (
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <button
                                                        type="button"
                                                        aria-label={`Filter kolom ${column.header}`}
                                                        className={cn(
                                                            'absolute top-1 right-2 z-10 rounded bg-muted p-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100',
                                                            column.filterActive &&
                                                                'text-primary opacity-100',
                                                        )}
                                                    >
                                                        <Filter className="size-3.5" />
                                                    </button>
                                                </PopoverTrigger>
                                                <PopoverContent align="start">
                                                    {column.headerFilter}
                                                </PopoverContent>
                                            </Popover>
                                        )}
                                        {
                                            <button
                                                type="button"
                                                aria-label={
                                                    nextColumn
                                                        ? `Resize divider between ${column.header} and ${nextColumn.header}`
                                                        : `Resize column ${column.header}`
                                                }
                                                className={cn(
                                                    'absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none opacity-0 outline-none group-hover:opacity-100 after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:bg-primary focus-visible:opacity-100',
                                                    // Handle ujung tetap di dalam tabel agar tidak menambah scrollWidth.
                                                    nextColumn ||
                                                        hasTrailingActions
                                                        ? '-right-1'
                                                        : 'right-0 after:right-0 after:left-auto',
                                                )}
                                                onPointerDown={(event) => {
                                                    if (event.button !== 0) {
                                                        return;
                                                    }

                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    event.currentTarget.setPointerCapture(
                                                        event.pointerId,
                                                    );
                                                    const measured =
                                                        measureWidths();
                                                    const guideLeft =
                                                        event.currentTarget.parentElement!.getBoundingClientRect()
                                                            .right -
                                                        (containerRef.current?.getBoundingClientRect()
                                                            .left ?? 0);
                                                    setResizeGuide(guideLeft);
                                                    resize.current = {
                                                        columnId: column.id,
                                                        nextColumnId:
                                                            nextColumn?.id ??
                                                            column.id,
                                                        startX: event.clientX,
                                                        startWidth:
                                                            measured[
                                                                column.id
                                                            ]!,
                                                        nextStartWidth:
                                                            measured[
                                                                nextColumn?.id ??
                                                                    column.id
                                                            ]!,
                                                        minWidth:
                                                            column.minWidth ??
                                                            80,
                                                        nextMinWidth:
                                                            nextColumn?.minWidth ??
                                                            80,
                                                        measuredWidths:
                                                            measured,
                                                        guideLeft,
                                                        utilityWidths:
                                                            measureUtilityWidths(),
                                                    };
                                                }}
                                                onPointerMove={(event) => {
                                                    const current =
                                                        resize.current;

                                                    if (
                                                        !current ||
                                                        current.columnId !==
                                                            column.id
                                                    ) {
                                                        return;
                                                    }

                                                    const nextWidths =
                                                        resizedWidths(
                                                            current,
                                                            event.clientX -
                                                                current.startX,
                                                        );
                                                    setResizeGuide(
                                                        current.guideLeft +
                                                            nextWidths[
                                                                current.columnId
                                                            ]! -
                                                            current.startWidth,
                                                    );
                                                }}
                                                onPointerUp={(event) => {
                                                    const current =
                                                        resize.current;

                                                    if (
                                                        current?.columnId ===
                                                        column.id
                                                    ) {
                                                        setUtilityWidths(
                                                            current.utilityWidths,
                                                        );
                                                        setWidths(
                                                            resizedWidths(
                                                                current,
                                                                event.clientX -
                                                                    current.startX,
                                                            ),
                                                        );
                                                    }

                                                    resize.current = null;
                                                    setResizeGuide(null);
                                                }}
                                                onPointerCancel={() => {
                                                    resize.current = null;
                                                    setResizeGuide(null);
                                                }}
                                                onLostPointerCapture={() => {
                                                    resize.current = null;
                                                    setResizeGuide(null);
                                                }}
                                                onKeyDown={(event) => {
                                                    if (
                                                        event.key !==
                                                            'ArrowLeft' &&
                                                        event.key !==
                                                            'ArrowRight'
                                                    ) {
                                                        return;
                                                    }

                                                    event.preventDefault();
                                                    const measured =
                                                        measureWidths();
                                                    const measuredUtilityWidths =
                                                        measureUtilityWidths();
                                                    setUtilityWidths(
                                                        measuredUtilityWidths,
                                                    );
                                                    setWidths(
                                                        resizedWidths(
                                                            {
                                                                columnId:
                                                                    column.id,
                                                                nextColumnId:
                                                                    nextColumn?.id ??
                                                                    column.id,
                                                                startX: 0,
                                                                startWidth:
                                                                    measured[
                                                                        column
                                                                            .id
                                                                    ]!,
                                                                nextStartWidth:
                                                                    measured[
                                                                        nextColumn?.id ??
                                                                            column.id
                                                                    ]!,
                                                                minWidth:
                                                                    column.minWidth ??
                                                                    80,
                                                                nextMinWidth:
                                                                    nextColumn?.minWidth ??
                                                                    80,
                                                                measuredWidths:
                                                                    measured,
                                                                guideLeft: 0,
                                                                utilityWidths:
                                                                    measuredUtilityWidths,
                                                            },
                                                            (event.key ===
                                                            'ArrowRight'
                                                                ? 1
                                                                : -1) *
                                                                (event.shiftKey
                                                                    ? 32
                                                                    : 8),
                                                        ),
                                                    );
                                                }}
                                            />
                                        }
                                    </TableHead>
                                    {hasInlineActions && columnIndex === 0 && (
                                        <TableHead
                                            data-column-kind="actions"
                                            className="h-9 border-b bg-muted/70 px-1"
                                        >
                                            <span className="sr-only">
                                                Tindakan
                                            </span>
                                        </TableHead>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {hasTrailingActions && (
                            <TableHead
                                data-column-kind="actions"
                                className="h-9 border-b bg-muted/70 px-2 text-right"
                            >
                                <span className="sr-only">Tindakan</span>
                            </TableHead>
                        )}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {renderRows ? (
                        renderRows()
                    ) : sortedData.length ? (
                        sortedData.map(renderRow)
                    ) : (
                        <TableRow>
                            <TableCell
                                colSpan={totalColumns}
                                className="h-24 text-center text-muted-foreground"
                            >
                                {incremental?.loading
                                    ? 'Memuat data…'
                                    : incremental?.error || emptyMessage}
                            </TableCell>
                        </TableRow>
                    )}
                    {incremental && (
                        <TableRow>
                            <TableCell
                                colSpan={totalColumns}
                                className="text-center text-muted-foreground"
                            >
                                <IncrementalListStatus
                                    state={incremental}
                                    endMessage={
                                        data.length
                                            ? 'Semua hasil sudah dimuat.'
                                            : undefined
                                    }
                                />
                            </TableCell>
                        </TableRow>
                    )}
                    {onAddRow && addRowMode === 'cells' && (
                        <TableRow data-add-row className="hover:bg-accent/40">
                            {selection && <TableCell />}
                            {showRowNumbers && (
                                <TableCell className="text-center text-muted-foreground">
                                    +
                                </TableCell>
                            )}
                            {columns.map((column, index) => (
                                <React.Fragment key={column.id}>
                                    <TableCell className="h-8 border-b p-0">
                                        <button
                                            type="button"
                                            onClick={() => onAddRow(column.id)}
                                            aria-label={`Tambah baris pada ${column.header}`}
                                            className="h-8 w-full px-2 text-left text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                                        >
                                            {index === 0 ? (
                                                addRowLabel
                                            ) : (
                                                <span aria-hidden="true">
                                                    &nbsp;
                                                </span>
                                            )}
                                        </button>
                                    </TableCell>
                                    {hasInlineActions && index === 0 && (
                                        <TableCell />
                                    )}
                                </React.Fragment>
                            ))}
                            {hasTrailingActions && <TableCell />}
                        </TableRow>
                    )}
                    {onAddRow && addRowMode === 'action' && (
                        // Baris kosong di bawah, seperti Edit List Business Central.
                        <TableRow className="hover:bg-accent/40">
                            <TableCell
                                colSpan={totalColumns}
                                className="h-9 border-b p-0"
                            >
                                <button
                                    type="button"
                                    onClick={() => onAddRow()}
                                    className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                                >
                                    <Plus className="size-3.5" />
                                    {addRowLabel}
                                </button>
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
            {resizeGuide !== null && (
                <div
                    className="pointer-events-none absolute inset-y-0 z-20 w-px bg-primary"
                    style={{ left: resizeGuide }}
                />
            )}
        </div>
    );
}

export { DataTable, DataTableText };
export type {
    DataTableColumn,
    DataTableRowAction,
    DataTableSort,
    DataTableSelection,
    DataTableProps,
};
