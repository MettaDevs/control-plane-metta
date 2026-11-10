/** Registry per kartu; perubahan header tidak merender ulang form pemiliknya. */
export function createPageDialogRecordStore<T extends object>() {
    const records = new Map<symbol, T>();
    const listeners = new Set<() => void>();
    let revision = 0;
    const notify = () => {
        revision++;
        listeners.forEach((listener) => listener());
    };

    return {
        subscribe: (listener: () => void) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        getRevision: () => revision,
        getRecord: () => [...records.values()].at(-1),
        set: (id: symbol, record: T | undefined) => {
            if (record === undefined) {
                if (records.delete(id)) {
                    notify();
                }

                return;
            }

            const previous = records.get(id);

            if (
                previous &&
                Object.keys(previous).length === Object.keys(record).length &&
                Object.keys(record).every(
                    (key) =>
                        Object.hasOwn(previous, key) &&
                        Object.is(
                            previous[key as keyof T],
                            record[key as keyof T],
                        ),
                )
            ) {
                return;
            }

            records.set(id, record);
            notify();
        },
    };
}
