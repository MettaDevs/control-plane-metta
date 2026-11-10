import { Badge } from '@control-plane-metta/ui/badge';
import { Button } from '@control-plane-metta/ui/button';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { displayDate } from '@control-plane-metta/ui/date-picker';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    definePage,
    errorText,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';
import {
    EnvironmentName,
    environmentStatus,
    OperationCell,
    operationName,
} from './environment-labels.tsx';

type Customer = ApiOutput<'showCustomer'>['customer'];
type Environment = Customer['tenants'][number]['environments'][number];
type Operation = Environment['operations'][number];

const openStatuses: ReadonlySet<Operation['status']> = new Set([
    'requested',
    'running',
]);
// Selama ada operasi yang belum ditutup worker, halaman dibaca ulang supaya kemajuannya terlihat tanpa memuat ulang.
const refreshMs = 3000;

function displayTime(value: string | null): string {
    if (!value) return '-';
    return new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

function hasOpenOperation(customer: Customer): boolean {
    return customer.tenants.some((tenant) =>
        tenant.environments.some((environment) =>
            environment.operations.some((operation) =>
                openStatuses.has(operation.status),
            ),
        ),
    );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm break-words">{children}</dd>
        </div>
    );
}

// Tenggat yang lewat baru ditutup gagal saat worker berikutnya membaca antrean, jadi layar menandainya lebih dulu.
function LeaseNote({ operation }: { operation: Operation }): ReactNode {
    if (
        operation.status !== 'running' ||
        !operation.lease_until ||
        new Date(operation.lease_until) >= new Date()
    )
        return null;
    return (
        <span className="text-xs text-destructive">
            Worker berhenti melapor sejak {displayTime(operation.lease_until)}.
        </span>
    );
}

function EnvironmentSection({
    environment,
    tenantHasProduction,
}: {
    environment: Environment;
    tenantHasProduction: boolean;
}): ReactNode {
    const status = environmentStatus(environment.status);
    const queryClient = useQueryClient();
    const { confirm, confirmation } = useConfirmation();
    const request = useMutation(
        orpc.requestEnvironmentOperation.mutationOptions({
            onSuccess: async (_response, input) => {
                toast.success(
                    `${operationName(input.body.operation)} menunggu diambil worker.`,
                );
                await queryClient.invalidateQueries({
                    queryKey: orpc.showCustomer.key(),
                });
            },
            onError: (caught, input) =>
                toast.error(
                    errorText(
                        caught,
                        `${operationName(input.body.operation)} belum diminta.`,
                    ),
                ),
        }),
    );
    const busy = environment.operations.some((operation) =>
        openStatuses.has(operation.status),
    );
    const busyReason = busy
        ? 'Lingkungan ini masih punya operasi yang belum selesai.'
        : null;
    const migrateUnavailable = !environment.database_name
        ? 'Lingkungan ini memakai database bersama; skemanya diperbarui bersama runtime.'
        : !environment.provisioned
          ? 'Penyiapan lingkungan ini belum pernah selesai.'
          : busyReason;
    const convertUnavailable =
        environment.status !== 'active'
            ? 'Demo ini belum aktif.'
            : tenantHasProduction
              ? 'Tenant ini sudah punya produksi.'
              : busyReason;
    async function ask(
        operation: 'migrate' | 'convert',
        question: { title: string; description: string; confirmLabel: string },
    ) {
        if (await confirm(question))
            request.mutate({
                params: { environment: environment.id },
                body: { operation },
            });
    }
    return (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">
                    <EnvironmentName environment={environment} />
                </h2>
                <Badge variant={status.variant}>{status.label}</Badge>
                {environment.status !== 'soft_deleted' && (
                    <div className="ml-auto flex flex-wrap gap-2">
                        {environment.kind === 'demo' && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={
                                    convertUnavailable !== null ||
                                    request.isPending
                                }
                                title={convertUnavailable ?? undefined}
                                onClick={() =>
                                    void ask('convert', {
                                        title: 'Jadikan demo ini produksi?',
                                        description:
                                            'Seluruh data yang diisi selama demo ikut menjadi data produksi. Alamatnya pindah dari alamat demo ke alamat produksi klinik ini, jadi pengguna perlu login lagi di alamat baru. Tanggal berakhir demo dilepas. Produksi tidak bisa dikembalikan menjadi demo.',
                                        confirmLabel: 'Jadikan produksi',
                                    })
                                }
                            >
                                Jadikan produksi
                            </Button>
                        )}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                                migrateUnavailable !== null || request.isPending
                            }
                            title={migrateUnavailable ?? undefined}
                            onClick={() =>
                                void ask('migrate', {
                                    title: 'Perbarui skema database?',
                                    description: `Worker di ${environment.runtime_host ?? 'host runtime'} menjalankan migration yang belum terpasang di ${environment.database_name ?? 'database ini'}, sampai skemanya sama dengan versi aplikasi di host itu. Migration tidak dapat dibatalkan setelah berjalan.`,
                                    confirmLabel: 'Perbarui skema',
                                })
                            }
                        >
                            Perbarui skema
                        </Button>
                    </div>
                )}
            </div>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Database">{environment.database_name ?? '-'}</Fact>
                <Fact label="Host runtime">
                    {environment.runtime_host ?? 'Belum diambil worker'}
                </Fact>
                <Fact label="Dibuat">
                    {displayTime(environment.created_at)}
                </Fact>
                <Fact label="Berakhir">
                    {environment.expires_at
                        ? displayDate(environment.expires_at)
                        : '-'}
                </Fact>
                {environment.purge_after && (
                    <Fact label="Isinya dibuang setelah">
                        {displayTime(environment.purge_after)}
                    </Fact>
                )}
            </dl>
            <DataTable
                data={environment.operations}
                getRowKey={(operation) => operation.id}
                scrollMode="inline"
                emptyMessage="Belum ada operasi untuk lingkungan ini."
                columns={[
                    {
                        id: 'operation',
                        header: 'Operasi',
                        cell: (operation) => (
                            <DataTableText>
                                {operationName(operation.operation)}
                            </DataTableText>
                        ),
                        minWidth: 120,
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        cell: (operation) => (
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <OperationCell operation={operation} />
                                <LeaseNote operation={operation} />
                            </div>
                        ),
                        minWidth: 320,
                    },
                    {
                        id: 'requested_by',
                        header: 'Diminta oleh',
                        cell: (operation) => (
                            <DataTableText>
                                {operation.requested_by ?? '-'}
                            </DataTableText>
                        ),
                        minWidth: 140,
                    },
                    {
                        id: 'requested_at',
                        header: 'Diminta',
                        cell: (operation) => (
                            <DataTableText>
                                {displayTime(operation.requested_at)}
                            </DataTableText>
                        ),
                        minWidth: 150,
                    },
                    {
                        id: 'started_at',
                        header: 'Mulai',
                        cell: (operation) => (
                            <DataTableText>
                                {displayTime(operation.started_at)}
                            </DataTableText>
                        ),
                        minWidth: 150,
                    },
                    {
                        id: 'finished_at',
                        header: 'Selesai',
                        cell: (operation) => (
                            <DataTableText>
                                {displayTime(operation.finished_at)}
                            </DataTableText>
                        ),
                        minWidth: 150,
                    },
                ]}
            />
            {confirmation}
        </section>
    );
}

function CustomerPage(): ReactNode {
    const { client } = useParams({ from: '/_app/customers/$client' });
    const { data: customer } = useSuspenseQuery(
        orpc.showCustomer.queryOptions({
            input: { params: { client } },
            select: (response) => response.customer,
            refetchInterval: (query) =>
                query.state.data && hasOpenOperation(query.state.data.customer)
                    ? refreshMs
                    : false,
        }),
    );

    return (
        <div className="flex flex-col gap-4">
            <RecordActionBar title={customer.legal_name} />
            <div className="flex flex-col gap-6 px-6 pb-6">
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Fact label="Slug">{customer.slug}</Fact>
                    <Fact label="Dibuat">
                        {displayTime(customer.created_at)}
                    </Fact>
                </dl>
                {customer.tenants.map((tenant) => (
                    <div key={tenant.id} className="flex flex-col gap-3">
                        {customer.tenants.length > 1 && (
                            <h2 className="text-sm font-semibold">
                                {tenant.name}{' '}
                                <span className="font-normal text-muted-foreground">
                                    ({tenant.slug})
                                </span>
                            </h2>
                        )}
                        {tenant.environments.length ? (
                            tenant.environments.map((environment) => (
                                <EnvironmentSection
                                    key={environment.id}
                                    environment={environment}
                                    tenantHasProduction={tenant.environments.some(
                                        (other) => other.kind === 'production',
                                    )}
                                />
                            ))
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                Belum ada lingkungan.
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/customers/$client',
    layout: 'app',
    title: 'Customer',
    component: CustomerPage,
});
