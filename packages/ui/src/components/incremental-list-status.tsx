import * as React from 'react';

export type IncrementalListState = {
    loading: boolean;
    error: string;
    hasMore: boolean;
    loadMore: () => void;
    retry: () => void;
};

/** Sentinel tabel, list, dan dropdown memakai pemilik scroll yang benar, termasuk overlay. */
export function IncrementalListStatus({
    state,
    endMessage,
}: {
    state: IncrementalListState;
    endMessage?: string;
}) {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const target = ref.current;

        if (!target || !state.hasMore || state.loading || state.error) {
            return;
        }

        let root = target.parentElement;

        while (root && root !== document.body) {
            if (
                root.scrollHeight > root.clientHeight + 1 &&
                /(auto|scroll)/.test(getComputedStyle(root).overflowY)
            ) {
                break;
            }

            root = root.parentElement;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    state.loadMore();
                }
            },
            { root: root === document.body ? null : root, rootMargin: '160px' },
        );
        observer.observe(target);

        return () => observer.disconnect();
    }, [state]);

    return (
        <div
            ref={ref}
            role="status"
            aria-live="polite"
            className="p-2 text-center text-sm text-muted-foreground"
        >
            {state.loading ? (
                'Memuat data…'
            ) : state.error ? (
                <button type="button" onClick={state.retry}>
                    {state.error} Coba lagi
                </button>
            ) : state.hasMore ? (
                <button type="button" onClick={state.loadMore}>
                    Muat data berikutnya
                </button>
            ) : (
                endMessage
            )}
        </div>
    );
}
