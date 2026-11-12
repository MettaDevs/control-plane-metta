import { DataTableText } from '@control-plane-metta/ui/data-table';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import type {
    environmentKindSchema,
    environmentStatusSchema,
    operationNameSchema,
    operationStatusSchema,
} from './customer.service.ts';

// Tipe dari schema service, bukan dari klien API konsol, supaya layar portal bisa memakai label yang sama tanpa ikut
// memuat bingkai konsol.
type Kind = z.infer<typeof environmentKindSchema>;
type Status = z.infer<typeof environmentStatusSchema>;
type Operation = {
    operation: z.infer<typeof operationNameSchema>;
    status: z.infer<typeof operationStatusSchema>;
    step: string | null;
    failure_message: string | null;
};

export function kindLabel(kind: Kind): string {
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

export function environmentStatus(status: Status): {
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
            return 'Update database';
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
        case 'sync_identities':
            return 'Penautan akun SSO';
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
    environment: { kind: Kind; name: string };
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
    operation: Operation | null;
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
