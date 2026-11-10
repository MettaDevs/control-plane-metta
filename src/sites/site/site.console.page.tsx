import {
    Alert,
    AlertDescription,
    AlertTitle,
} from '@control-plane-metta/ui/alert';
import { Badge } from '@control-plane-metta/ui/badge';
import { Button } from '@control-plane-metta/ui/button';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
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
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { Select } from '@control-plane-metta/ui/select';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Copy, TriangleAlert } from 'lucide-react';
import { Suspense, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    definePage,
    errorText,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';
import { displayTime, siteState } from './site-labels.tsx';

type Site = ApiOutput<'showSite'>['site'];
type Operation = Site['operations'][number];

const openStatuses = new Set(['requested', 'running']);
// Selama ada operasi yang belum ditutup agen, halaman dibaca ulang supaya kemajuannya terlihat tanpa memuat ulang.
const refreshMs = 3000;
// Hanya operasi yang belum diambil agen yang dapat dibatalkan.
const cancelAction = { id: 'cancel', label: 'Batalkan' };

// Kolom operasi di database berupa teks bebas, jadi nama yang belum dikenal layar ini ditampilkan apa adanya.
function operationName(operation: string): string {
    switch (operation) {
        case 'install':
            return 'Pemasangan';
        case 'upgrade':
            return 'Pembaruan';
        case 'backup':
            return 'Backup';
        case 'install_license':
            return 'Pasang lisensi';
        case 'rotate_key':
            return 'Ganti kunci agen';
        case 'send_diagnostics':
            return 'Kirim diagnostik';
        default:
            return operation;
    }
}

function operationStatus(status: string): string {
    switch (status) {
        case 'requested':
            return 'Menunggu diambil agen';
        case 'running':
            return 'Sedang berjalan';
        case 'succeeded':
            return 'Selesai';
        case 'failed':
            return 'Gagal';
        case 'cancelled':
            return 'Dibatalkan';
        case 'expired':
            return 'Kedaluwarsa, tidak diambil agen';
        default:
            return status;
    }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm break-words">{children}</dd>
        </div>
    );
}

// Token tampil sekali di sini. Server tidak menyimpannya dan tidak akan mengirimnya lagi.
function EnrollmentTokenPanel({
    token,
    minutes,
}: {
    token: string;
    minutes: number;
}): ReactNode {
    return (
        <div className="flex flex-col gap-3">
            <Alert>
                <TriangleAlert />
                <AlertTitle>
                    Simpan token ini sekarang. Token ini tidak akan ditampilkan
                    lagi.
                </AlertTitle>
                <AlertDescription>
                    Jalankan coreerp-agent enroll di server klien dengan token
                    ini. Token berlaku {minutes} menit dan hanya bisa dipakai
                    sekali; membuat token baru membatalkan token ini.
                </AlertDescription>
            </Alert>
            <div className="flex flex-wrap items-center gap-2">
                <code
                    className="rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all select-all"
                    data-test="enrollment-token"
                >
                    {token}
                </code>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(token);
                            toast.success('Token disalin.');
                        } catch {
                            toast.error(
                                'Token belum tersalin. Pilih teksnya lalu salin manual.',
                            );
                        }
                    }}
                >
                    <Copy />
                    Salin token
                </Button>
            </div>
        </div>
    );
}

function UpgradeDialog({
    site,
    open,
    onOpenChange,
}: {
    site: Site;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const content = useRef<HTMLDivElement>(null);
    const [release, setRelease] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const { data: releases } = useSuspenseQuery(
        orpc.listReleases.queryOptions({
            select: (response) =>
                response.releases.filter(
                    (item) => item.edition === site.edition,
                ),
        }),
    );
    const upgrade = useMutation(
        orpc.requestOperation.mutationOptions({
            onMutate: () => setMessage(null),
            onSuccess: async () => {
                toast.success(
                    `Pembaruan ke rilis ${release} menunggu diambil agen.`,
                );
                onOpenChange(false);
                await queryClient.invalidateQueries({
                    queryKey: orpc.showSite.key(),
                });
            },
            onError: (caught) =>
                setMessage(errorText(caught, 'Pembaruan belum diminta.')),
        }),
    );

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    setRelease(null);
                    setMessage(null);
                }
                onOpenChange(next);
            }}
        >
            <DialogContent size="compact" ref={content}>
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!release) {
                            setMessage('Pilih rilis tujuan.');
                            return;
                        }
                        upgrade.mutate({
                            params: { site: site.id },
                            body: { operation: 'upgrade', release },
                        });
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Perbarui server klien</DialogTitle>
                        <DialogDescription>
                            Agen menjalankan pembaruan di dalam jam pembaruan
                            server ini. Rilis terpasang sekarang{' '}
                            {site.reported_release ?? 'belum dilaporkan'}.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody className="flex flex-col gap-3">
                        <Select
                            label="Rilis tujuan"
                            required
                            placeholder="Pilih rilis"
                            searchPlaceholder="Cari…"
                            emptyMessage="Belum ada rilis terdaftar untuk edisi server ini."
                            items={releases.map((item) => item.release)}
                            value={release}
                            onValueChange={setRelease}
                            portalContainer={content}
                        />
                        {message && (
                            <p
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {message}
                            </p>
                        )}
                    </DialogBody>
                    <DialogFooter>
                        <DialogAction
                            type="submit"
                            disabled={upgrade.isPending}
                        >
                            {upgrade.isPending ? 'Meminta…' : 'Minta pembaruan'}
                        </DialogAction>
                        <DialogCancel />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function OperationCell({ operation }: { operation: Operation }): ReactNode {
    return (
        <div className="flex min-w-0 flex-col gap-0.5 py-1 text-sm">
            <span>{operationStatus(operation.status)}</span>
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

function SitePage(): ReactNode {
    const { site: siteId } = useParams({ from: '/_app/sites/$site' });
    const queryClient = useQueryClient();
    const { confirm, confirmation } = useConfirmation();
    const [token, setToken] = useState<{
        token: string;
        minutes: number;
    } | null>(null);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const { data: site } = useSuspenseQuery(
        orpc.showSite.queryOptions({
            input: { params: { site: siteId } },
            select: (response) => response.site,
            refetchInterval: (query) =>
                query.state.data?.site.operations.some((operation) =>
                    openStatuses.has(operation.status),
                )
                    ? refreshMs
                    : false,
        }),
    );
    const refresh = () =>
        queryClient.invalidateQueries({ queryKey: orpc.showSite.key() });

    const issueToken = useMutation(
        orpc.issueEnrollmentToken.mutationOptions({
            onSuccess: (response) =>
                setToken({
                    token: response.token,
                    minutes: response.expires_in_minutes,
                }),
            onError: (caught) =>
                toast.error(errorText(caught, 'Token belum dibuat.')),
        }),
    );
    const requestOperation = useMutation(
        orpc.requestOperation.mutationOptions({
            onSuccess: async (_response, input) => {
                toast.success(
                    `${operationName(input.body.operation)} menunggu diambil agen.`,
                );
                await refresh();
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Operasi belum diminta.')),
        }),
    );
    const cancelOperation = useMutation(
        orpc.cancelOperation.mutationOptions({
            onSuccess: async () => {
                toast.success('Operasi dibatalkan.');
                await refresh();
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Operasi belum dibatalkan.')),
        }),
    );
    const revoke = useMutation(
        orpc.revokeSite.mutationOptions({
            onSuccess: async () => {
                toast.success('Server klien dicabut.');
                setToken(null);
                await refresh();
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Server klien belum dicabut.')),
        }),
    );

    const state = siteState(site.state);
    const revoked = site.state === 'revoked';
    const enrolled = site.state === 'active' || site.state === 'stale';
    const notEnrolledTitle = revoked
        ? 'Server ini sudah dicabut.'
        : 'Agen server ini belum pernah tersambung.';
    const ask = (operation: 'backup' | 'rotate_key' | 'send_diagnostics') =>
        requestOperation.mutate({
            params: { site: site.id },
            body: { operation },
        });

    return (
        <div className="flex flex-col gap-4">
            <RecordActionBar
                title={site.name}
                groups={[
                    {
                        id: 'server',
                        label: 'Server',
                        actions: [
                            {
                                id: 'enrollment-token',
                                label: 'Token pendaftaran',
                                disabled: revoked || issueToken.isPending,
                                title: revoked
                                    ? 'Server ini sudah dicabut.'
                                    : undefined,
                                onSelect: () =>
                                    issueToken.mutate({
                                        params: { site: site.id },
                                    }),
                            },
                            {
                                id: 'upgrade',
                                label: 'Perbarui',
                                disabled: !enrolled,
                                title: enrolled ? undefined : notEnrolledTitle,
                                onSelect: () => setUpgradeOpen(true),
                            },
                            {
                                id: 'revoke',
                                label: 'Cabut',
                                disabled: revoked || revoke.isPending,
                                title: revoked
                                    ? 'Server ini sudah dicabut.'
                                    : undefined,
                                onSelect: async () => {
                                    if (
                                        await confirm({
                                            title: `Cabut ${site.name}?`,
                                            description:
                                                'Agen di server ini langsung ditolak dan operasi yang belum diambil dibatalkan. Server yang sudah dicabut tidak bisa disambungkan lagi.',
                                            confirmLabel: 'Cabut',
                                            destructive: true,
                                        })
                                    )
                                        revoke.mutate({
                                            params: { site: site.id },
                                        });
                                },
                            },
                        ],
                    },
                    {
                        id: 'operations',
                        label: 'Operasi',
                        actions: (
                            [
                                'backup',
                                'rotate_key',
                                'send_diagnostics',
                            ] as const
                        ).map((operation) => ({
                            id: operation,
                            label: operationName(operation),
                            disabled: !enrolled || requestOperation.isPending,
                            title: enrolled ? undefined : notEnrolledTitle,
                            onSelect: () => ask(operation),
                        })),
                    },
                ]}
            />
            <div className="flex flex-col gap-6 px-6 pb-6">
                {token && (
                    <EnrollmentTokenPanel
                        token={token.token}
                        minutes={token.minutes}
                    />
                )}
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Fact label="Status">
                        <Badge variant={state.variant}>{state.label}</Badge>
                    </Fact>
                    <Fact label="Klinik">{site.tenant_name}</Fact>
                    <Fact label="Edisi">{site.edition}</Fact>
                    <Fact label="Rilis terpasang">
                        {site.reported_release ?? '-'}
                    </Fact>
                    <Fact label="Alamat server">
                        {site.server_address ?? '-'}
                    </Fact>
                    <Fact label="Laporan terakhir">
                        {displayTime(site.last_seen_at)}
                    </Fact>
                </dl>
                <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold">Operasi</h2>
                    <DataTable
                        data={site.operations}
                        getRowKey={(operation) => operation.id}
                        getRowLabel={(operation) =>
                            operationName(operation.operation)
                        }
                        scrollMode="inline"
                        emptyMessage="Belum ada operasi untuk server ini."
                        actions={[cancelAction]}
                        getRowActions={(operation) =>
                            operation.status === 'requested'
                                ? [cancelAction]
                                : []
                        }
                        onRowAction={(_action, operation) =>
                            cancelOperation.mutate({
                                params: {
                                    site: site.id,
                                    operation: operation.id,
                                },
                            })
                        }
                        columns={[
                            {
                                id: 'operation',
                                header: 'Operasi',
                                cell: (operation) => (
                                    <DataTableText>
                                        {operationName(operation.operation)}
                                    </DataTableText>
                                ),
                                minWidth: 160,
                            },
                            {
                                id: 'status',
                                header: 'Status',
                                cell: (operation) => (
                                    <OperationCell operation={operation} />
                                ),
                                minWidth: 240,
                            },
                            {
                                id: 'requested_at',
                                header: 'Diminta',
                                cell: (operation) => (
                                    <DataTableText>
                                        {displayTime(operation.requested_at)}
                                    </DataTableText>
                                ),
                                minWidth: 160,
                            },
                            {
                                id: 'finished_at',
                                header: 'Selesai',
                                cell: (operation) => (
                                    <DataTableText>
                                        {displayTime(operation.finished_at)}
                                    </DataTableText>
                                ),
                                minWidth: 160,
                            },
                        ]}
                    />
                </section>
            </div>
            {/* Daftar rilis dimuat saat dialog dibuka; halaman tetap tampil selama menunggu. */}
            {upgradeOpen && (
                <Suspense fallback={null}>
                    <UpgradeDialog
                        site={site}
                        open={upgradeOpen}
                        onOpenChange={setUpgradeOpen}
                    />
                </Suspense>
            )}
            {confirmation}
        </div>
    );
}

export const page = definePage({
    path: '/sites/$site',
    layout: 'app',
    title: 'Server klien',
    component: SitePage,
});
