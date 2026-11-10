'use client';

import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from 'lucide-react';
import * as React from 'react';

import { cn } from '../utils';
import { Button } from './button';
import { IncrementalListStatus } from './incremental-list-status';
import type { IncrementalListState } from './incremental-list-status';
import { Input } from './input';

export type TransferListItem = {
    id: string;
    label: string;
    description?: string;
};

function TransferListPane({
    title,
    items,
    highlighted,
    onHighlight,
    onActivate,
    disabled,
    emptyLabel,
    incremental,
    searchValue,
    onSearchChange,
    size,
    reserveSearchSpace = false,
}: {
    title: string;
    size: 'default' | 'large';
    reserveSearchSpace?: boolean;
    items: TransferListItem[];
    highlighted: string | null;
    onHighlight: (id: string) => void;
    onActivate: (id: string) => void;
    disabled?: boolean;
    emptyLabel: string;
    incremental?: IncrementalListState;
    searchValue?: string;
    onSearchChange?: (value: string) => void;
}) {
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {title}
            </p>
            {onSearchChange && (
                <Input
                    aria-label={`Cari ${title}`}
                    placeholder="Cari"
                    value={searchValue ?? ''}
                    onChange={(event) => onSearchChange(event.target.value)}
                />
            )}
            {!onSearchChange && reserveSearchSpace && (
                <div aria-hidden="true" className="h-9 shrink-0" />
            )}
            {/*
        Ukuran bawaan mengikuti isi sampai batas atas; ukuran besar memakai tinggi layar.

        Panel ini hampir selalu dipasang di dalam permukaan yang sudah bergulir sendiri.
        Kotak bertinggi tetap membuat area gulir kedua yang menumpuk di dalam yang pertama,
        sehingga roda tetikus di atas daftar menggulirkan kotaknya, bukan halamannya —
        padahal umumnya isinya hanya beberapa baris dan tidak ada yang perlu digulirkan
        sama sekali. Dengan `max-h`, gulir kedua hanya muncul ketika daftarnya memang
        melampaui batas, dan `overscroll-contain` menahan gulirnya agar tidak merembet ke
        permukaan induk begitu mentok.
      */}
            <div
                className={cn(
                    'overflow-y-auto overscroll-contain rounded-md border',
                    size === 'large'
                        ? 'h-[min(52dvh,36rem)] min-h-64'
                        : 'max-h-56 min-h-24',
                )}
            >
                {items.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                        {emptyLabel}
                    </p>
                ) : (
                    <ul className="divide-y">
                        {items.map((item) => (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    disabled={disabled}
                                    aria-pressed={highlighted === item.id}
                                    onClick={() => onHighlight(item.id)}
                                    onDoubleClick={() => onActivate(item.id)}
                                    className={cn(
                                        'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                        highlighted === item.id
                                            ? 'bg-accent text-accent-foreground'
                                            : 'hover:bg-muted/50',
                                    )}
                                >
                                    <span className="font-medium">
                                        {item.label}
                                    </span>
                                    {item.description && (
                                        <span className="text-xs text-muted-foreground">
                                            {item.description}
                                        </span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {incremental && <IncrementalListStatus state={incremental} />}
            </div>
        </div>
    );
}

/**
 * Dual-listbox picker: everything unassigned on the left, everything assigned on the
 * right, with single or bulk transfer between them. This is the shape for assigning a
 * bounded reference list to a record — job types, counters, attribute types, condition
 * templates — where seeing the assigned set against everything unassigned is the point.
 * A `MultiSelect` combobox is the right tool when the source list is large or searched;
 * this is the right tool when both sides need to stay visible at once.
 *
 * Selection inside a pane only highlights a row for the transfer buttons — it never
 * assigns anything by itself. Only `→`/`←`/`⇒`/`⇐` (or double-clicking a row) move an
 * item, so a single click can never be mistaken for a commit.
 */
function TransferList({
    remaining,
    selected,
    onChange,
    remainingTitle,
    selectedTitle,
    disabled,
    remainingEmptyLabel = 'Tidak ada data.',
    selectedEmptyLabel = 'Belum ada yang dipilih.',
    className,
    incremental,
    searchValue,
    onSearchChange,
    size = 'default',
    onActiveItemChange,
}: {
    size?: 'default' | 'large';
    /** Pratinjau baris aktif terpisah dari pemindahan dan perubahan pilihan. */
    onActiveItemChange?: (id: string) => void;
    remaining: TransferListItem[];
    selected: TransferListItem[];
    onChange: (next: {
        remaining: TransferListItem[];
        selected: TransferListItem[];
    }) => void;
    remainingTitle: string;
    selectedTitle: string;
    disabled?: boolean;
    remainingEmptyLabel?: string;
    selectedEmptyLabel?: string;
    className?: string;
    incremental?: IncrementalListState;
    searchValue?: string;
    onSearchChange?: (value: string) => void;
}) {
    const [highlightedRemaining, setHighlightedRemaining] = React.useState<
        string | null
    >(null);
    const [highlightedSelected, setHighlightedSelected] = React.useState<
        string | null
    >(null);

    function moveToSelected(id: string) {
        const item = remaining.find((candidate) => candidate.id === id);

        if (!item) {
            return;
        }

        setHighlightedRemaining(null);
        onChange({
            remaining: remaining.filter((candidate) => candidate.id !== id),
            selected: [...selected, item],
        });
    }

    function moveToRemaining(id: string) {
        const item = selected.find((candidate) => candidate.id === id);

        if (!item) {
            return;
        }

        setHighlightedSelected(null);
        onChange({
            remaining: [...remaining, item],
            selected: selected.filter((candidate) => candidate.id !== id),
        });
    }

    function moveAllToSelected() {
        if (remaining.length === 0) {
            return;
        }

        setHighlightedRemaining(null);
        onChange({ remaining: [], selected: [...selected, ...remaining] });
    }

    function moveAllToRemaining() {
        if (selected.length === 0) {
            return;
        }

        setHighlightedSelected(null);
        onChange({ remaining: [...remaining, ...selected], selected: [] });
    }

    return (
        <div
            data-slot="transfer-list"
            className={cn('flex items-stretch gap-3', className)}
        >
            <TransferListPane
                size={size}
                incremental={incremental}
                searchValue={searchValue}
                onSearchChange={onSearchChange}
                title={remainingTitle}
                items={remaining}
                highlighted={highlightedRemaining}
                onHighlight={(id) => {
                    setHighlightedRemaining(id);

                    if (onActiveItemChange) {
                        setHighlightedSelected(null);
                    }

                    onActiveItemChange?.(id);
                }}
                onActivate={moveToSelected}
                disabled={disabled}
                emptyLabel={remainingEmptyLabel}
            />
            <div className="flex flex-col justify-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={disabled || !highlightedRemaining}
                    onClick={() =>
                        highlightedRemaining &&
                        moveToSelected(highlightedRemaining)
                    }
                    aria-label="Pindahkan yang dipilih ke sisi kanan"
                >
                    <ChevronRight />
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={disabled || !highlightedSelected}
                    onClick={() =>
                        highlightedSelected &&
                        moveToRemaining(highlightedSelected)
                    }
                    aria-label="Pindahkan yang dipilih ke sisi kiri"
                >
                    <ChevronLeft />
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={disabled || remaining.length === 0}
                    onClick={moveAllToSelected}
                    aria-label={
                        incremental
                            ? 'Pindahkan data yang sudah tampil ke sisi kanan'
                            : 'Pindahkan semua ke sisi kanan'
                    }
                >
                    <ChevronsRight />
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={disabled || selected.length === 0}
                    onClick={moveAllToRemaining}
                    aria-label="Pindahkan semua ke sisi kiri"
                >
                    <ChevronsLeft />
                </Button>
            </div>
            <TransferListPane
                size={size}
                title={selectedTitle}
                reserveSearchSpace={size === 'large' && Boolean(onSearchChange)}
                items={selected}
                highlighted={highlightedSelected}
                onHighlight={(id) => {
                    setHighlightedSelected(id);

                    if (onActiveItemChange) {
                        setHighlightedRemaining(null);
                    }

                    onActiveItemChange?.(id);
                }}
                onActivate={moveToRemaining}
                disabled={disabled}
                emptyLabel={selectedEmptyLabel}
            />
        </div>
    );
}

export { TransferList };
