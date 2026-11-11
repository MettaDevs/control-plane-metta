import { DataTableText } from '@control-plane-metta/ui/data-table';
import type { ReactNode } from 'react';
import type { ApiOutput } from '../../platform/shell/index.ts';

type Environment =
    ApiOutput<'listCustomers'>['customers'][number]['environments'][number];
type Operation = NonNullable<Environment['operation']>;

export function kindLabel(kind: Environment['kind']): string {
    switch (kind) {
        case 'production':
            return 'Produksi';
        case 'sandbox':
            return 'Sandbox';
        case 'demo':
            return 'Demo';
        default: {
            const unknown: never = kind;
            return unknown;
        }
    }
}

export function environmentStatus(status: Environment['status']): {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
    switch (status) {
        case 'provisioning':
            return { label: 'Sedang disiapkan', variant: 'secondary' };
        case 'copying':
            return { label: 'Sedang disalin', variant: 'secondary' };
        case 'active':
            return { label: 'Aktif', variant: 'default' };
        case 'maintenance':
            return { label: 'Pemeliharaan', variant: 'outline' };
        case 'degraded':
            return { label: 'Bermasalah', variant: 'destructive' };
        case 'suspended':
            return { label: 'Dihentikan sementara', variant: 'outline' };
        case 'soft_deleted':
            return { label: 'Dihapus', variant: 'outline' };
        default: {
            const unknown: never = status;
            return { label: unknown, variant: 'outline' };
        }
    }
}

export function operationName(operation: Operation['operation']): string {
    switch (operation) {
        case 'provision':
            return 'Penyiapan';
        case 'migrate':
            return 'Pembaruan skema';
        case 'convert':
            return 'Jadikan produksi';
        case 'expire':
            return 'Kedaluwarsa';
        case 'restore':
            return 'Pemulihan';
        case 'purge':
            return 'Pembuangan';
        case 'sync_entitlements':
            return 'Penerapan module';
        default: {
            const unknown: never = operation;
            return unknown;
        }
    }
}

export function operationStatus(status: Operation['status']): string {
    switch (status) {
        case 'requested':
            return 'menunggu diambil worker';
        case 'running':
            return 'sedang berjalan';
        case 'succeeded':
            return 'selesai';
        case 'failed':
            return 'gagal';
        default: {
            const unknown: never = status;
            return unknown;
        }
    }
}

// Nama bawaan lingkungan sama dengan jenisnya ("Demo"), jadi jenisnya hanya ditulis bila operator memberi nama lain.
export function EnvironmentName({
    environment,
}: {
    environment: Pick<Environment, 'kind' | 'name'>;
}): ReactNode {
    const kind = kindLabel(environment.kind);
    return environment.name === kind ? (
        <span>{kind}</span>
    ) : (
        <span>
            {environment.name}{' '}
            <span className="text-muted-foreground">({kind})</span>
        </span>
    );
}

export function OperationCell({
    operation,
}: {
    operation: Environment['operation'];
}): ReactNode {
    if (!operation) return <DataTableText>-</DataTableText>;
    return (
        <div className="flex min-w-0 flex-col gap-0.5 py-1 text-sm">
            <span>
                {operationName(operation.operation)}{' '}
                {operationStatus(operation.status)}
            </span>
            {operation.status === 'failed' && operation.failure_message ? (
                <span className="text-xs break-words text-destructive">
                    {operation.failure_message}
                </span>
            ) : (
                operation.step && (
                    <span className="text-xs text-muted-foreground">
                        Langkah: {operation.step}
                    </span>
                )
            )}
        </div>
    );
}
