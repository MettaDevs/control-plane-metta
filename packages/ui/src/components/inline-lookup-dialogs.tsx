import * as React from 'react';
import { Button } from './button';
import { DataTable, DataTableText } from './data-table';
import type { DataTableColumn, DataTableSort } from './data-table';
import { Input } from './input';
import {
    PageDialog,
    PageDialogAction,
    PageDialogBody,
    PageDialogContent,
    PageDialogFooter,
} from './page-dialog';

/** PageDialog bawaan lookup memakai data dan kolom yang sudah diberikan pemanggil. */
export function InlineLookupListDialog<T>({
    items,
    search,
    onSearchChange,
    loading,
    error,
    onRetry,
    onScrollCapture,
    sort,
    onSortChange,
    columns,
    value,
    label,
    emptyMessage,
    getItemValue,
    onChoose,
    onClose,
    onDetails,
}: {
    items: T[];
    search: string;
    onSearchChange: (search: string) => void;
    loading: boolean;
    error: string;
    onRetry: () => void;
    onScrollCapture: React.UIEventHandler<HTMLElement>;
    sort: DataTableSort | null;
    onSortChange: (sort: DataTableSort | null) => void;
    columns: DataTableColumn<T>[];
    value: T | null;
    label: string;
    emptyMessage: string;
    getItemValue: (item: T) => string;
    onChoose: (item: T) => void;
    onClose: () => void;
    onDetails?: (item: T) => void;
}) {
    const [candidateKey, setCandidateKey] = React.useState(
        value === null ? null : getItemValue(value),
    );
    const filtered = items;
    const candidate =
        candidateKey === null
            ? null
            : (filtered.find((item) => getItemValue(item) === candidateKey) ??
              null);

    return (
        <PageDialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <PageDialogContent
                title={<>Daftar lengkap — {label}</>}
                description="Pilih satu baris, lalu tekan Pilih."
            >
                <PageDialogBody
                    className="flex min-h-0 flex-col"
                    onScrollCapture={onScrollCapture}
                >
                    <div className="flex min-h-0 flex-1 flex-col gap-4">
                        {onDetails && (
                            <Button
                                variant="outline"
                                disabled={candidate === null}
                                onClick={() => {
                                    if (candidate !== null) {
                                        onDetails(candidate);
                                    }
                                }}
                            >
                                Detail
                            </Button>
                        )}
                        <Input
                            label="Cari daftar"
                            value={search}
                            onChange={(event) =>
                                onSearchChange(event.target.value)
                            }
                        />
                        <DataTable
                            columns={columns}
                            data={filtered}
                            sort={sort}
                            onSortChange={onSortChange}
                            getRowKey={getItemValue}
                            rowActivation="single-click"
                            onRowClick={(item) =>
                                setCandidateKey(getItemValue(item))
                            }
                            activeRowKey={candidateKey ?? undefined}
                            scrollMode="viewport"
                            emptyMessage={
                                loading
                                    ? 'Memuat pilihan…'
                                    : error || emptyMessage
                            }
                        />
                        {loading && (
                            <p
                                role="status"
                                className="text-sm text-muted-foreground"
                            >
                                Memuat pilihan…
                            </p>
                        )}
                        {error && (
                            <div
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {error}
                                <Button variant="outline" onClick={onRetry}>
                                    Coba lagi
                                </Button>
                            </div>
                        )}
                    </div>
                </PageDialogBody>
                <PageDialogFooter>
                    <PageDialogAction
                        disabled={candidate === null}
                        onClick={() => {
                            if (candidate !== null) {
                                onChoose(candidate);
                            }
                        }}
                    >
                        Pilih
                    </PageDialogAction>
                    <Button variant="outline" onClick={onClose}>
                        Batal
                    </Button>
                </PageDialogFooter>
            </PageDialogContent>
        </PageDialog>
    );
}

export function InlineLookupDetailsDialog<T>({
    item,
    columns,
    title,
    onClose,
}: {
    item: T;
    columns: DataTableColumn<T>[];
    title: string;
    onClose: () => void;
}) {
    return (
        <PageDialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <PageDialogContent
                title={<>Detail {title}</>}
                description="Melihat detail tidak mengubah pilihan pada field."
            >
                <PageDialogBody>
                    <dl className="grid gap-4 sm:grid-cols-2">
                        {columns.map((column) => (
                            <div key={column.id} className="min-w-0 space-y-1">
                                <dt className="text-sm text-muted-foreground">
                                    {column.header}
                                </dt>
                                <dd>
                                    <DataTableText multiline>
                                        {column.cell(item)}
                                    </DataTableText>
                                </dd>
                            </div>
                        ))}
                    </dl>
                </PageDialogBody>
                <PageDialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Tutup
                    </Button>
                </PageDialogFooter>
            </PageDialogContent>
        </PageDialog>
    );
}
