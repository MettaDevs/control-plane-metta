import { Maximize2 } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { DocumentLinePortal } from '../document-line-context';
import { cn } from '../utils';
import { ActionButton } from './action-button';
import { Button } from './button';
import { DataTable } from './data-table';
import type { DataTableProps, DataTableSelection } from './data-table';
import { PageDialog, PageDialogContent } from './page-dialog';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const editable =
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([readonly]):not(:disabled),textarea:not(:disabled),select:not(:disabled),button[role="combobox"]:not(:disabled)';

/** Enter milik editor hanya berlaku untuk input teks/angka yang sedang tidak membuka pilihan. */
export function shouldAdvanceDocumentLine(
    event: {
        key: string;
        defaultPrevented: boolean;
        isComposing: boolean;
        altKey: boolean;
        ctrlKey: boolean;
        metaKey: boolean;
        shiftKey: boolean;
    },
    field: {
        type: string;
        readOnly: boolean;
        expanded: boolean;
        combobox: boolean;
        calendar: boolean;
    },
) {
    return (
        event.key === 'Enter' &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !field.readOnly &&
        !field.expanded &&
        !field.combobox &&
        !field.calendar &&
        [
            'text',
            'number',
            'search',
            'email',
            'tel',
            'url',
            'password',
        ].includes(field.type)
    );
}

export type DocumentLinesProps<T> = Omit<
    DataTableProps<T>,
    | 'cellMode'
    | 'cellPortalContainer'
    | 'onAddRow'
    | 'addRowMode'
    | 'scrollMode'
    | 'className'
> & {
    title: string;
    toolbar?: React.ReactNode;
    footer?: React.ReactNode;
    feedback?: React.ReactNode;
    portalContainer?: DocumentLinePortal;
    onAddRow?: () => void;
    onDeleteRows?: (rows: T[]) => void;
    disabled?: boolean;
    /** Blokir penambahan/penghapusan baris; pemanggil memakai sel teks untuk tampilan baca. Seleksi tetap tersedia. */
    readOnly?: boolean;
    className?: string;
};

/** Editor tetap mounted saat host dipindahkan ke focus mode, sehingga lebar kolom dan draft kontrol tidak hilang. */
export function DocumentLines<T>({
    title,
    toolbar,
    footer,
    feedback,
    portalContainer,
    onAddRow,
    onDeleteRows,
    disabled = false,
    readOnly = false,
    className,
    selection: providedSelection,
    columns,
    data,
    getRowKey,
    ...tableProps
}: DocumentLinesProps<T>) {
    const [focused, setFocused] = React.useState(false);
    const [selectedKeys, setSelectedKeys] = React.useState<React.Key[]>([]);
    const [host] = React.useState(() => {
        if (typeof document === 'undefined') {
            return null;
        }

        const node = document.createElement('div');
        node.className = 'flex min-h-0 flex-1 flex-col';

        return node;
    });
    const hydrated = React.useSyncExternalStore(
        subscribe,
        clientSnapshot,
        serverSnapshot,
    );
    const inlineRef = React.useRef<HTMLDivElement>(null);
    const focusRef = React.useRef<HTMLDivElement>(null);
    const focusSlot = React.useRef<HTMLDivElement>(null);
    const pending = React.useRef<{
        columnId?: string;
        keys: Set<React.Key>;
    } | null>(null);
    const selection: DataTableSelection | undefined =
        providedSelection ??
        (onDeleteRows
            ? { selectedKeys, onSelectedKeysChange: setSelectedKeys }
            : undefined);
    const selected = new Set(selection?.selectedKeys ?? []);
    const selectedRows = data.filter((row) => selected.has(getRowKey(row)));

    const attachFocus = React.useCallback(
        (node: HTMLDivElement | null) => {
            focusSlot.current = node;

            if (node && host) {
                node.appendChild(host);
            }
        },
        [host],
    );

    React.useLayoutEffect(() => {
        if (!host || !hydrated) {
            return;
        }

        const destination = focused ? focusSlot.current : inlineRef.current;

        if (destination && host.parentElement !== destination) {
            destination.appendChild(host);
        }
    }, [focused, host, hydrated]);

    React.useLayoutEffect(() => {
        const request = pending.current;

        if (!request || !host) {
            return;
        }

        const row = data.find((item) => !request.keys.has(getRowKey(item)));

        if (!row) {
            return;
        }

        const rowNode = host.querySelector<HTMLElement>(
            `[data-row-key="${CSS.escape(String(getRowKey(row)))}"]`,
        );
        const cell = request.columnId
            ? rowNode?.querySelector<HTMLElement>(
                  `[data-column-id="${CSS.escape(request.columnId)}"]`,
              )
            : null;
        (
            cell?.querySelector<HTMLElement>(editable) ??
            rowNode?.querySelector<HTMLElement>(editable)
        )?.focus();
        pending.current = null;
    }, [data, getRowKey, host]);

    const add = (columnId?: string) => {
        if (disabled || readOnly || !onAddRow || pending.current) {
            return;
        }

        pending.current = { columnId, keys: new Set(data.map(getRowKey)) };
        onAddRow();
    };
    const changeFocused = (next: boolean) => {
        setFocused(next);
    };
    const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const input = event.target;

        if (disabled || readOnly || !(input instanceof HTMLInputElement)) {
            return;
        }

        if (
            !shouldAdvanceDocumentLine(
                { ...event, isComposing: event.nativeEvent.isComposing },
                {
                    type: input.type,
                    readOnly: input.readOnly,
                    expanded: input.getAttribute('aria-expanded') === 'true',
                    combobox: input.getAttribute('role') === 'combobox',
                    calendar: Boolean(
                        input.closest('[data-slot="date-picker"]'),
                    ),
                },
            )
        ) {
            return;
        }

        const row = input.closest('[data-row-key]');

        if (!row || !host) {
            return;
        }

        const controls = Array.from(
            host.querySelectorAll<HTMLElement>('[data-row-key]'),
        );
        const rowControls = controls.flatMap((row) =>
            Array.from(row.querySelectorAll<HTMLElement>(editable)),
        );
        const index = rowControls.indexOf(input);

        if (index < 0) {
            return;
        }

        event.preventDefault();

        if (rowControls[index + 1]) {
            rowControls[index + 1].focus();
        } else {
            add(columns.find((column) => column.content === 'control')?.id);
        }
    };
    const editor = (
        <div
            data-slot="document-lines-editor"
            data-focused={focused || undefined}
            className={cn('flex min-w-0 flex-col', focused && 'min-h-0 flex-1')}
            onKeyDown={keyboard}
        >
            <div
                data-slot="document-lines-toolbar"
                className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1"
            >
                {!readOnly && onAddRow && (
                    <ActionButton
                        action="add"
                        type="button"
                        disabled={disabled}
                        onClick={() => add()}
                    />
                )}
                {!readOnly && onDeleteRows && (
                    <ActionButton
                        action="delete"
                        disabled={disabled || selectedRows.length === 0}
                        onClick={() => {
                            onDeleteRows(selectedRows);
                            selection?.onSelectedKeysChange([]);
                        }}
                    />
                )}
                {toolbar}
                {!focused && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ms-auto"
                        data-document-focus-trigger
                        aria-label={`Buka mode fokus ${title}`}
                        title="Mode fokus"
                        onClick={() => changeFocused(true)}
                    >
                        <Maximize2 aria-hidden="true" />
                    </Button>
                )}
            </div>
            {focused && feedback}
            <fieldset
                disabled={disabled}
                className={cn(
                    'min-w-0 border-0 p-0',
                    focused && 'flex min-h-0 flex-1 flex-col',
                )}
            >
                <DataTable
                    {...tableProps}
                    columns={columns}
                    data={data}
                    getRowKey={getRowKey}
                    selection={selection}
                    cellMode="document"
                    cellPortalContainer={focused ? focusRef : portalContainer}
                    scrollMode={focused ? 'viewport' : 'inline'}
                    addRowMode="cells"
                    onAddRow={!readOnly && onAddRow ? add : undefined}
                />
            </fieldset>
            {footer && (
                <div
                    data-slot="document-lines-footer"
                    className="shrink-0 border-t px-3 py-2"
                >
                    {footer}
                </div>
            )}
        </div>
    );

    return (
        <div data-slot="document-lines" className={cn('min-w-0', className)}>
            <div ref={inlineRef} />
            {hydrated && host ? createPortal(editor, host) : editor}
            <PageDialog open={focused} onOpenChange={changeFocused}>
                <PageDialogContent
                    ref={focusRef}
                    title={title}
                    expanded
                    onExpandedChange={(next) => {
                        if (!next) {
                            changeFocused(false);
                        }
                    }}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        host?.querySelector<HTMLElement>(editable)?.focus();
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();

                        if (host) {
                            inlineRef.current?.appendChild(host);
                        }

                        inlineRef.current
                            ?.querySelector<HTMLElement>(
                                '[data-document-focus-trigger]',
                            )
                            ?.focus();
                    }}
                >
                    <div
                        ref={attachFocus}
                        className="flex min-h-0 flex-1 flex-col"
                    />
                </PageDialogContent>
            </PageDialog>
        </div>
    );
}
