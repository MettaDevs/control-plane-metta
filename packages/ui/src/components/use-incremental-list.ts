import * as React from 'react';
import type { DataTableSort } from './data-table';
import { SEARCH_DEBOUNCE_MS } from './record-search.js';

export type ListBatch<T> = { items: T[]; nextCursor: string | null };
export type ListRequest = {
    query: string;
    cursor: string | null;
    sort: DataTableSort | null;
    signal: AbortSignal;
};
export type ListLoader<T> = (request: ListRequest) => Promise<ListBatch<T>>;
const EMPTY: never[] = [];

export function assertListBatch<T>(
    value: unknown,
): asserts value is ListBatch<T> {
    if (
        !value ||
        typeof value !== 'object' ||
        !('items' in value) ||
        !Array.isArray(value.items) ||
        !('nextCursor' in value) ||
        (value.nextCursor !== null &&
            (typeof value.nextCursor !== 'string' ||
                value.nextCursor === '' ||
                value.items.length === 0))
    ) {
        throw new Error('Data belum dapat dimuat. Coba muat ulang daftar.');
    }
}

/** Pertahankan urutan batch server; opsi lokal seperti "semua" tetap di awal. */
export function visibleListOptions<T extends { value: string }>(
    items: T[],
    visibleValues?: string[],
    knownValues?: string[],
): T[] {
    if (!visibleValues) {
        return items;
    }

    const order = new Map(visibleValues.map((value, index) => [value, index]));
    const known = new Set(knownValues);

    return items
        .filter((item) => order.has(item.value) || !known.has(item.value))
        .sort(
            (left, right) =>
                (order.get(left.value) ?? -1) - (order.get(right.value) ?? -1),
        );
}

/** Mengubah pilihan yang terlihat tidak mencabut relasi yang labelnya belum dimuat. */
export function mergeListSelection(
    selected: string[],
    known: string[],
    next: string[],
): string[] {
    const available = new Set(known);

    return [
        ...new Set([
            ...next,
            ...selected.filter((value) => !available.has(value)),
        ]),
    ];
}

/** Satu sumber pemuatan daftar: reset pencarian/urutan, batalkan respons basi, dan lanjut saat scroll. */
export function useIncrementalList<T>({
    loadItems,
    query = '',
    active = true,
    getKey,
}: {
    loadItems: ListLoader<T>;
    query?: string;
    active?: boolean;
    getKey: (item: T) => React.Key;
}) {
    const [sort, setSort] = React.useState<DataTableSort | null>(null);
    const [revision, setRevision] = React.useState(0);
    const [state, setState] = React.useState<{
        source?: ListLoader<T>;
        key: string;
        items: T[];
        nextCursor: string | null;
        loading: boolean;
        error: string;
    }>({ key: '', items: [], nextCursor: null, loading: false, error: '' });
    const key = JSON.stringify([query, sort, revision]);
    const pending = React.useRef<AbortController | null>(null);
    const cursors = React.useRef(new Set<string>());
    const keyOf = React.useRef(getKey);
    keyOf.current = getKey;
    const fetchBatch = React.useCallback(
        async (cursor: string | null) => {
            if (pending.current) {
                return;
            }

            const request = new AbortController();
            pending.current = request;
            setState((current) => ({
                ...current,
                source: loadItems,
                key,
                items: cursor === null ? [] : current.items,
                nextCursor: cursor === null ? null : current.nextCursor,
                loading: true,
                error: '',
            }));

            try {
                const batch = await loadItems({
                    query,
                    sort,
                    cursor,
                    signal: request.signal,
                });

                if (request.signal.aborted) {
                    return;
                }

                assertListBatch<T>(batch);

                if (
                    batch.nextCursor !== null &&
                    cursors.current.has(batch.nextCursor)
                ) {
                    throw new Error(
                        'Data berikutnya belum dapat dimuat. Coba muat ulang daftar.',
                    );
                }

                if (batch.nextCursor !== null) {
                    cursors.current.add(batch.nextCursor);
                }

                setState((current) => {
                    const rows = new Map(
                        (cursor === null ? [] : current.items).map((item) => [
                            keyOf.current(item),
                            item,
                        ]),
                    );
                    batch.items.forEach((item) =>
                        rows.set(keyOf.current(item), item),
                    );

                    return {
                        source: loadItems,
                        key,
                        items: [...rows.values()],
                        nextCursor: batch.nextCursor,
                        loading: false,
                        error: '',
                    };
                });
            } catch (error) {
                if (!request.signal.aborted) {
                    setState((current) => ({
                        ...current,
                        loading: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : 'Data belum dapat dimuat.',
                    }));
                }
            } finally {
                if (pending.current === request) {
                    pending.current = null;
                }
            }
        },
        [loadItems, query, sort, key],
    );
    React.useEffect(() => {
        cursors.current.clear();
        pending.current?.abort();
        pending.current = null;

        if (!active) {
            return;
        }

        const timer = setTimeout(
            () => void fetchBatch(null),
            query.trim() ? SEARCH_DEBOUNCE_MS : 0,
        );

        return () => {
            clearTimeout(timer);
            pending.current?.abort();
            pending.current = null;
        };
    }, [active, fetchBatch, key, query, loadItems]);
    const current = state.key === key && state.source === loadItems;
    const loadMore = React.useCallback(() => {
        if (
            active &&
            current &&
            !state.loading &&
            !state.error &&
            state.nextCursor
        ) {
            void fetchBatch(state.nextCursor);

            return true;
        }

        return false;
    }, [active, current, state, fetchBatch]);

    return {
        items: current ? state.items : EMPTY,
        loading: active && (!current || state.loading),
        error: current ? state.error : '',
        hasMore: current && state.nextCursor !== null,
        loadMore,
        sort,
        onSortChange: setSort,
        reload: () => setRevision((value) => value + 1),
        retry: () => void fetchBatch(state.nextCursor),
        setItems: (update: React.SetStateAction<T[]>) =>
            setState((current) => ({
                ...current,
                items:
                    typeof update === 'function'
                        ? (update as (items: T[]) => T[])(current.items)
                        : update,
            })),
    };
}
