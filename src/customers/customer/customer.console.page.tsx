import { Badge } from '@control-plane-metta/ui/badge';
import { Button } from '@control-plane-metta/ui/button';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import {
    DatePicker,
    dateValue,
    displayDate,
} from '@control-plane-metta/ui/date-picker';
import {
    Dialog,
    DialogAction,
    DialogBody,
    DialogCancel,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@control-plane-metta/ui/dialog';
import { FormControl, FormGrid } from '@control-plane-metta/ui/form-control';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    definePage,
    ApiError,
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
import { ModuleEntitlements } from './module-entitlements.tsx';
import { PortalAccessSection } from './portal-access-section.tsx';

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

// Hak module yang belum diterapkan di lingkungan aktif juga ditunggu: worker akan mengambilnya tanpa diminta.
function hasOpenOperation(customer: Customer): boolean {
    return customer.tenants.some((tenant) =>
        tenant.environments.some(
            (environment) =>
                (environment.status === 'active' &&
                    !environment.entitlements_applied) ||
                environment.operations.some((operation) =>
                    openStatuses.has(operation.status),
                ),
        ),
    );
}

function displaySize(bytes: number | null): string {
    if (bytes === null) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)} ${units[unit] ?? 'B'}`;
}

// Kesehatan menurut laporan terakhir worker host-nya, beserta waktunya, supaya laporan yang basi terlihat basi.
function HealthNote({ environment }: { environment: Environment }): ReactNode {
    if (environment.reported_healthy === null || !environment.reported_at)
        return <span className="text-muted-foreground">Belum dilaporkan</span>;
    return (
        <span className="flex flex-col gap-0.5">
            {environment.reported_healthy ? (
                <span>Sehat</span>
            ) : (
                <span className="text-destructive">
                    Bermasalah
                    {environment.reported_problem
                        ? `: ${environment.reported_problem}`
                        : ''}
                </span>
            )}
            <span className="text-xs text-muted-foreground">
                Dilaporkan {displayTime(environment.reported_at)}
            </span>
        </span>
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

function tomorrow(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return dateValue(date);
}

// Demo yang dipulihkan wajib diberi tanggal berakhir baru; tanpa itu ia langsung kedaluwarsa lagi. Lingkungan lain
// cukup dikonfirmasi.
function RestoreDialog({
    environment,
    open,
    onOpenChange,
}: {
    environment: Environment;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const content = useRef<HTMLDivElement>(null);
    const [expiresAt, setExpiresAt] = useState('');
    const [error, setError] = useState<string | null>(null);
    const demo = environment.kind === 'demo';
    const restore = useMutation(
        orpc.requestEnvironmentOperation.mutationOptions({
            onMutate: () => setError(null),
            onSuccess: async () => {
                toast.success('Pemulihan menunggu diambil worker.');
                onOpenChange(false);
                await queryClient.invalidateQueries({
                    queryKey: orpc.showCustomer.key(),
                });
            },
            onError: (caught) =>
                setError(
                    caught instanceof ApiError && caught.errors.expires_at
                        ? (caught.errors.expires_at[0] ?? caught.message)
                        : errorText(caught, 'Pemulihan belum diminta.'),
                ),
        }),
    );
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    setExpiresAt('');
                    setError(null);
                }
                onOpenChange(next);
            }}
        >
            <DialogContent size="compact" ref={content}>
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (demo && !expiresAt) {
                            setError('Pilih tanggal berakhir demo yang baru.');
                            return;
                        }
                        restore.mutate({
                            params: { environment: environment.id },
                            body: {
                                operation: 'restore',
                                ...(demo ? { expires_at: expiresAt } : {}),
                            },
                        });
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Pulihkan lingkungan ini?</DialogTitle>
                        <DialogDescription>
                            Alamatnya dinyalakan lagi, dan lingkungan kembali ke
                            keadaannya sebelum dihapus beserta seluruh isinya.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        <FormGrid columns={1}>
                            {demo && (
                                <FormControl error={error ?? undefined}>
                                    <DatePicker
                                        label="Demo berakhir"
                                        required
                                        min={tomorrow()}
                                        value={expiresAt}
                                        onValueChange={setExpiresAt}
                                        portalContainer={content}
                                    />
                                </FormControl>
                            )}
                            {!demo && error && (
                                <p
                                    role="alert"
                                    className="text-sm text-destructive"
                                >
                                    {error}
                                </p>
                            )}
                        </FormGrid>
                    </DialogBody>
                    <DialogFooter>
                        <DialogAction
                            type="submit"
                            disabled={restore.isPending}
                        >
                            {restore.isPending ? 'Meminta…' : 'Pulihkan'}
                        </DialogAction>
                        <DialogCancel />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
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
    const [restoreOpen, setRestoreOpen] = useState(false);
    const graceOver =
        environment.purge_after !== null &&
        new Date(environment.purge_after) <= new Date();
    const restoreUnavailable = graceOver
        ? 'Masa tenggangnya sudah habis.'
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
                {environment.status === 'soft_deleted' && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        disabled={restoreUnavailable !== null}
                        title={restoreUnavailable ?? undefined}
                        onClick={() => setRestoreOpen(true)}
                    >
                        Pulihkan
                    </Button>
                )}
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
                                    title: 'Update database lingkungan ini?',
                                    description: `Struktur tabel di ${environment.database_name ?? 'database ini'} disamakan dengan versi aplikasi yang sedang berjalan di ${environment.runtime_host ?? 'host runtime'}. Data tidak dihapus. Setelah berjalan, perubahan ini tidak dapat dibatalkan.`,
                                    confirmLabel: 'Update database',
                                })
                            }
                        >
                            Update database
                        </Button>
                    </div>
                )}
            </div>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Alamat">
                    {environment.address ? (
                        <a
                            href={environment.address}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline-offset-4 hover:underline"
                        >
                            {environment.address.replace(/^https?:\/\//, '')}
                        </a>
                    ) : (
                        '-'
                    )}
                </Fact>
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
                        : environment.kind === 'demo'
                          ? 'Tanpa batas'
                          : '-'}
                </Fact>
                {environment.purge_after && (
                    <Fact label="Isinya dibuang setelah">
                        {displayTime(environment.purge_after)}
                    </Fact>
                )}
                <Fact label="Kesehatan">
                    <HealthNote environment={environment} />
                </Fact>
                <Fact label="Skema">
                    {environment.reported_migrations?.core ?? '-'}
                </Fact>
                <Fact label="Ukuran database">
                    {displaySize(environment.reported_size_bytes)}
                </Fact>
                <Fact label="Module">
                    {environment.entitlements_applied
                        ? 'Sesuai hak tenant'
                        : environment.status === 'active'
                          ? 'Menunggu diterapkan'
                          : 'Diterapkan setelah lingkungan aktif'}
                </Fact>
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
            {restoreOpen && (
                <RestoreDialog
                    environment={environment}
                    open={restoreOpen}
                    onOpenChange={setRestoreOpen}
                />
            )}
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
                <PortalAccessSection clientId={customer.client_id} />
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
                        <ModuleEntitlements tenant={tenant} />
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
