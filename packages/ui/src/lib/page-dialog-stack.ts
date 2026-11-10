export type PageDialogStackEntry = {
    id: symbol;
    host: HTMLElement;
    node: HTMLDivElement;
    opener: HTMLElement | null;
};
type HostState = {
    background: HTMLElement | null;
    previouslyInert: boolean;
    opener: HTMLElement | null;
};
const entries: PageDialogStackEntry[] = [];
const hosts = new Map<HTMLElement, HostState>();
const listeners = new Set<() => void>();
let revision = 0;
function publish() {
    revision++;
    listeners.forEach((listener) => listener());
}
export function subscribePageDialogs(listener: () => void) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
export const getPageDialogRevision = () => revision;
export const getPageDialogStack = (host: HTMLElement) =>
    entries.filter((entry) => entry.host === host);
export function registerPageDialog(entry: PageDialogStackEntry) {
    if (!hosts.has(entry.host)) {
        const background =
            entry.host
                .closest('[data-shell-content]')
                ?.querySelector<HTMLElement>('[data-shell-page-content]') ??
            null;
        hosts.set(entry.host, {
            background,
            previouslyInert: background?.inert ?? false,
            opener: entry.opener,
        });

        if (background) {
            background.inert = true;
        }
    }

    entries.push(entry);
    publish();

    return () => {
        const group = entries.filter((item) => item.host === entry.host);
        const wasActive = group.at(-1)?.id === entry.id;
        const hostState = hosts.get(entry.host);
        const index = entries.indexOf(entry);

        if (index !== -1) {
            entries.splice(index, 1);
        }

        const remaining = entries.filter((item) => item.host === entry.host);

        if (!remaining.length) {
            if (hostState?.background) {
                hostState.background.inert = hostState.previouslyInert;
            }

            hosts.delete(entry.host);
        }

        publish();

        if (wasActive) {
            requestAnimationFrame(() => {
                const target = entry.opener?.isConnected
                    ? entry.opener
                    : hostState?.opener;

                if (target?.isConnected && !target.closest('[inert]')) {
                    target.focus();
                } else {
                    remaining
                        .at(-1)
                        ?.node.querySelector<HTMLButtonElement>(
                            '[data-page-dialog-back]',
                        )
                        ?.focus();
                }
            });
        }
    };
}
