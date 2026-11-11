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
import { FormControl } from '@control-plane-metta/ui/form-control';
import { Input } from '@control-plane-metta/ui/input';
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
                    <DialogBody className="flex flex-col gap-3">
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

// Produksi disalin menjadi sandbox baru; operator memberi nama sandbox itu. Produksi tidak berhenti selama disalin.
function CopyDialog({
    environment,
    open,
    onOpenChange,
}: {
    environment: Environment;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const [name, setName] = useState('Sandbox');
    const [error, setError] = useState<string | null>(null);
    const copy = useMutation(
        orpc.requestEnvironmentOperation.mutationOptions({
            onMutate: () => setError(null),
            onSuccess: async () => {
                toast.success('Salinan ke sandbox menunggu diambil worker.');
                onOpenChange(false);
                await queryClient.invalidateQueries({
                    queryKey: orpc.showCustomer.key(),
                });
            },
            onError: (caught) =>
                setError(errorText(caught, 'Salinan belum diminta.')),
        }),
    );
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) setError(null);
                onOpenChange(next);
            }}
        >
            <DialogContent size="compact">
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        copy.mutate({
                            params: { environment: environment.id },
                            body: { operation: 'copy', name },
                        });
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Salin produksi ke sandbox?</DialogTitle>
                        <DialogDescription>
                            Seluruh data produksi saat ini disalin ke sandbox
                            baru milik klinik yang sama. Produksi tetap berjalan
                            selama disalin. Di sandbox, antrean pengiriman,
                            ekspor laporan, dan sesi login dari produksi
                            dibuang, jadi tidak ada yang terkirim keluar dari
                            salinan ini.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody className="flex flex-col gap-3">
                        <FormControl error={error ?? undefined}>
                            <Input
                                label="Nama sandbox"
                                required
                                maxLength={100}
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                            />
                        </FormControl>
                    </DialogBody>
                    <DialogFooter>
                        <DialogAction type="submit" disabled={copy.isPending}>
                            {copy.isPending ? 'Meminta…' : 'Salin ke sandbox'}
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
    tenantSandbox,
}: {
    environment: Environment;
    tenantHasProduction: boolean;
    tenantSandbox: Environment | undefined;
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
    const [copyOpen, setCopyOpen] = useState(false);
    // Sandbox yang penyalinannya gagal boleh disalin ulang; sandbox yang hidup tidak pernah ditimpa.
    const copyUnavailable =
        environment.status !== 'active'
            ? 'Produksi ini belum aktif.'
            : !environment.database_name
              ? 'Produksi ini memakai database bersama.'
              : tenantSandbox && tenantSandbox.status !== 'degraded'
                ? 'Tenant ini sudah punya sandbox.'
                : busyReason;
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
                        {environment.kind === 'production' && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={copyUnavailable !== null}
                                title={copyUnavailable ?? undefined}
                                onClick={() => setCopyOpen(true)}
                            >
                                {tenantSandbox?.status === 'degraded'
                                    ? 'Salin ulang ke sandbox'
                                    : 'Salin ke sandbox'}
                            </Button>
                        )}
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
            {copyOpen && (
                <CopyDialog
                    environment={environment}
                    open={copyOpen}
                    onOpenChange={setCopyOpen}
                />
            )}
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
                                    tenantSandbox={tenant.environments.find(
                                        (other) =>
                                            other.kind === 'sandbox' &&
                                            other.status !== 'soft_deleted',
                                    )}
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
