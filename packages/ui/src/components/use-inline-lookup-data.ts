import * as React from 'react';
import type { DataTableColumn, DataTableSort } from './data-table';
import { matchesRecordSearch } from './record-search';
import { useIncrementalList } from './use-incremental-list';
import type { ListBatch, ListRequest } from './use-incremental-list';

export function lookupComparator<T>(
    columns: DataTableColumn<T>[],
    sort: DataTableSort | null,
) {
    const column = columns.find((item) => item.id === sort?.columnId);

    if (!sort || !column?.sortValue) {
        return undefined;
    }

    return (left: T, right: T) => {
        const a = column.sortValue!(left);
        const b = column.sortValue!(right);
        const result =
            typeof a === 'number' && typeof b === 'number'
                ? a - b
                : String(a).localeCompare(String(b), 'id-ID');

        return result * (sort.direction === 'asc' ? 1 : -1);
    };
}

export type LookupLoader<T> = (request: {
    query: string;
    cursor: string | null;
    signal: AbortSignal;
}) => Promise<{ items: T[]; nextCursor: string | null }>;

/** Popup dan daftar lengkap memakai mesin fetch yang sama dengan tabel operasional. */
export function useInlineLookupData<T>({
    items = [],
    loadItems,
    query,
    active,
    getItemValue,
    getSearchText,
    compareItems,
}: {
    items?: T[];
    loadItems?: LookupLoader<T>;
    query: string;
    active: boolean;
    getItemValue: (item: T) => string;
    getSearchText: (item: T) => string;
    compareItems?: (left: T, right: T) => number;
}) {
    const [localWindow, setLocalWindow] = React.useState({
        query,
        source: items,
        count: 40,
    });
    const visibleCount =
        localWindow.query === query && localWindow.source === items
            ? localWindow.count
            : 40;
    const cacheEpoch = React.useRef(0);
    const cache = React.useRef<{
        source: LookupLoader<T>;
        query: string;
        batch: ListBatch<T>;
        loadedAt: number;
    } | null>(null);
    const loader = React.useCallback(
        async (request: ListRequest) => {
            if (!loadItems) {
                return { items: [], nextCursor: null };
            }

            if (
                !request.cursor &&
                cache.current?.source === loadItems &&
                cache.current.query === request.query &&
                Date.now() - cache.current.loadedAt < 30_000
            ) {
                return cache.current.batch;
            }

            const epoch = cacheEpoch.current;
            const batch = await loadItems(request);

            if (
                !request.cursor &&
                !request.signal.aborted &&
                epoch === cacheEpoch.current
            ) {
                cache.current = {
                    source: loadItems,
                    query: request.query,
                    batch,
                    loadedAt: Date.now(),
                };
            }

            return batch;
        },
        [loadItems],
    );
    const remote = useIncrementalList({
        loadItems: loader,
        query,
        active: active && Boolean(loadItems),
        getKey: getItemValue,
    });
    const filtered = loadItems
        ? []
        : items.filter((item) =>
              matchesRecordSearch(query, getSearchText(item)),
          );

    if (compareItems && !loadItems) {
        filtered.sort(compareItems);
    }

    const displayed = loadItems
        ? remote.items
        : filtered.slice(0, visibleCount);
    const hasMore = loadItems ? remote.hasMore : filtered.length > visibleCount;
    const loadMore = () => {
        if (!hasMore || remote.loading || remote.error) {
            return;
        }

        if (loadItems) {
            remote.loadMore();
        } else {
            setLocalWindow({ query, source: items, count: visibleCount + 40 });
        }
    };
    const onScrollCapture: React.UIEventHandler<HTMLElement> = (event) => {
        const target = event.target;

        if (
            target instanceof HTMLElement &&
            target.scrollHeight - target.scrollTop - target.clientHeight < 160
        ) {
            loadMore();
        }
    };

    return {
        invalidate: () => {
            cache.current = null;
            cacheEpoch.current++;
            remote.reload();
        },
        items: displayed,
        loading: remote.loading,
        error: remote.error,
        hasMore,
        loadMore,
        onScrollCapture,
        retry: remote.retry,
    };
}
