import * as React from 'react';
import { cn } from '../utils';
import {
    Combobox,
    ComboboxCollection,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
    ComboboxValue,
} from './combobox';
import { IncrementalListStatus } from './incremental-list-status';
import type { IncrementalListState } from './incremental-list-status';
import { mergeListSelection, visibleListOptions } from './use-incremental-list';

type MultiSelectItem = string | { value: string; label: string };

type MultiSelectProps = {
    incremental?: IncrementalListState;
    visibleValues?: string[];
    knownValues?: string[];
    onSearchChange?: (query: string) => void;
    searchValue?: string;
    /** Teks saja, atau pasangan nilai dan label bila yang disimpan id sedangkan yang dibaca orang namanya. */
    items: MultiSelectItem[];
    value?: string[];
    defaultValue?: string[];
    onValueChange?: (value: string[]) => void;
    /** Label di dalam field, sama dengan `Select`. Tanpa label, `placeholder` yang tampil saat kosong. */
    label?: string;
    ariaLabel?: string;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    className?: string;
    /**
     * Wajib diisi saat komponen berada di dalam dialog. Tanpa ini popup ikut
     * portal ke `document.body`, berada di luar dialog, dan klik pada item
     * ditelan oleh focus trap dialog.
     */
    portalContainer?:
        | HTMLElement
        | ShadowRoot
        | null
        | React.RefObject<HTMLElement | ShadowRoot | null>;
};

type NormalizedItem = { value: string; label: string };

/**
 * Pilihan banyak dari daftar terbatas, misalnya filter laporan "lokasi A atau B".
 *
 * Nilai yang tidak ada di `items` — master yang sudah diarsipkan, atau daftar yang belum selesai dimuat —
 * tidak ditampilkan sebagai id. Ia ikut terbuang begitu pengguna mengubah pilihannya.
 */
function MultiSelect({
    items,
    value,
    defaultValue = [],
    onValueChange,
    label,
    ariaLabel,
    placeholder = 'Select items',
    searchPlaceholder = 'Search...',
    emptyMessage = 'No items found.',
    className,
    portalContainer,
    incremental,
    visibleValues,
    knownValues,
    onSearchChange,
    searchValue,
}: MultiSelectProps) {
    const normalized = React.useMemo<NormalizedItem[]>(
        () =>
            items.map((item) =>
                typeof item === 'string' ? { value: item, label: item } : item,
            ),
        [items],
    );
    const [internalValue, setInternalValue] = React.useState(defaultValue);
    const selectedValues = value ?? internalValue;
    const displayed = visibleListOptions(
        normalized,
        visibleValues,
        knownValues,
    );
    const selectedItems = selectedValues
        .map((selected) => normalized.find((item) => item.value === selected))
        .filter((item): item is NormalizedItem => item !== undefined);
    const inputId = React.useId();
    const unknownSelected = incremental
        ? selectedValues.filter(
              (value) => !normalized.some((item) => item.value === value),
          )
        : [];
    const hasValue = selectedItems.length > 0 || unknownSelected.length > 0;

    const updateValue = (nextItems: NormalizedItem[]) => {
        const next = nextItems.map((item) => item.value);
        const nextValue = incremental
            ? mergeListSelection(
                  selectedValues,
                  normalized.map((item) => item.value),
                  next,
              )
            : next;

        if (value === undefined) {
            setInternalValue(nextValue);
        }

        onValueChange?.(nextValue);
    };

    return (
        <Combobox
            items={displayed}
            filter={incremental ? null : undefined}
            inputValue={searchValue}
            onInputValueChange={(value, details) => {
                if (
                    details.reason === 'input-change' ||
                    details.reason === 'input-clear'
                ) {
                    onSearchChange?.(value);
                }
            }}
            multiple
            value={selectedItems}
            onValueChange={updateValue}
            itemToStringLabel={(item: NormalizedItem) => item.label}
            itemToStringValue={(item: NormalizedItem) => item.value}
            isItemEqualToValue={(item, selected) =>
                item.value === selected.value
            }
        >
            <div className="group/select relative w-full">
                <ComboboxTrigger
                    id={inputId}
                    aria-label={ariaLabel ?? label}
                    className={cn(
                        label
                            ? 'flex h-9 w-full items-center justify-between gap-2 rounded-[4px] border border-[#d9dfe7] bg-white px-3 py-1 text-left text-sm text-[#1f2937] shadow-none transition-colors outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 disabled:cursor-not-allowed disabled:opacity-50 data-[popup-open]:border-[#0284c7] data-[popup-open]:ring-2 data-[popup-open]:ring-[#0284c7]/15 dark:border-input dark:bg-input/30 dark:text-foreground [&>[data-slot=combobox-trigger-icon]]:ml-auto [&>[data-slot=combobox-trigger-icon]]:shrink-0'
                            : 'flex min-h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground dark:bg-input/30',
                        className,
                    )}
                >
                    <ComboboxValue placeholder={label ? '' : placeholder}>
                        {(values: NormalizedItem[] | null) => (
                            <span className="min-w-0 flex-1 truncate">
                                {[
                                    values
                                        ?.map((item) => item.label)
                                        .join(', '),
                                    unknownSelected.length
                                        ? `${unknownSelected.length} pilihan tersimpan`
                                        : '',
                                ]
                                    .filter(Boolean)
                                    .join(', ') || (label ? '' : placeholder)}
                            </span>
                        )}
                    </ComboboxValue>
                </ComboboxTrigger>
                {label && (
                    <label
                        htmlFor={inputId}
                        className={cn(
                            'pointer-events-none absolute start-3 z-10 px-1 leading-none transition-all',
                            hasValue
                                ? 'top-0 -translate-y-1/2 bg-white text-xs text-foreground group-has-[button[data-popup-open]]/select:text-[#0284c7] dark:bg-input/30'
                                : 'top-1/2 -translate-y-1/2 text-sm text-foreground',
                        )}
                    >
                        {label}
                    </label>
                )}
            </div>
            <ComboboxContent container={portalContainer}>
                <ComboboxInput
                    placeholder={searchPlaceholder}
                    showSearchIcon
                    showTrigger={false}
                />
                <ComboboxEmpty>
                    {incremental?.loading
                        ? 'Memuat pilihan…'
                        : incremental?.error || emptyMessage}
                </ComboboxEmpty>
                <ComboboxList>
                    <ComboboxCollection>
                        {(item: NormalizedItem) => (
                            <ComboboxItem key={item.value} value={item}>
                                {item.label}
                            </ComboboxItem>
                        )}
                    </ComboboxCollection>
                    {incremental && (
                        <IncrementalListStatus state={incremental} />
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}

export { MultiSelect };
export type { MultiSelectItem };
