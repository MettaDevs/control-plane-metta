import { Badge } from '@control-plane-metta/ui/badge';
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
import { FormControl, FormGrid } from '@control-plane-metta/ui/form-control';
import { Input } from '@control-plane-metta/ui/input';
import { Label } from '@control-plane-metta/ui/label';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { Select } from '@control-plane-metta/ui/select';
import { Switch } from '@control-plane-metta/ui/switch';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    definePage,
    errorText,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type Host = ApiOutput<'listRuntimeHosts'>['runtime_hosts'][number];

const settingsAction = { id: 'settings', label: 'Ubah pengaturan' };
const revokeAction = {
    id: 'revoke',
    label: 'Cabut',
    destructive: true,
};

const ringLabels: Record<Host['ring'], string> = {
    canary: 'Canary',
    early: 'Early',
    general: 'General',
};

function availabilityBadge(availability: Host['availability']): {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
    switch (availability) {
        case 'available':
            return { label: 'Tersedia', variant: 'default' };
        case 'full':
            return { label: 'Penuh', variant: 'secondary' };
        case 'paused':
            return { label: 'Tidak menerima baru', variant: 'secondary' };
        case 'silent':
            return { label: 'Tidak melapor', variant: 'destructive' };
        case 'revoked':
            return { label: 'Dicabut', variant: 'outline' };
        default: {
            const unknown: never = availability;
            return { label: unknown, variant: 'outline' };
        }
    }
}

// Pengaturan penempatan satu host. Host khusus hanya dipakai bila operator memilihnya langsung saat membuat customer.
function SettingsDialog({
    host,
    onOpenChange,
}: {
    host: Host;
    onOpenChange: (open: boolean) => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const content = useRef<HTMLDivElement>(null);
    const [acceptsNew, setAcceptsNew] = useState(host.accepts_new);
    const [capacity, setCapacity] = useState(
        host.capacity === null ? '' : String(host.capacity),
    );
    const [dedicated, setDedicated] = useState(host.dedicated);
    const [ring, setRing] = useState<Host['ring']>(host.ring);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const save = useMutation(
        orpc.updateRuntimeHostSettings.mutationOptions({
            onMutate: () => {
                setErrors({});
                setMessage(null);
            },
            onSuccess: async () => {
                toast.success('Pengaturan host runtime disimpan.');
                onOpenChange(false);
                await queryClient.invalidateQueries({
                    queryKey: orpc.listRuntimeHosts.key(),
                });
            },
            onError: (caught) => {
                if (caught instanceof ApiError && caught.status === 422)
                    setErrors(caught.errors);
                else
                    setMessage(errorText(caught, 'Pengaturan belum disimpan.'));
            },
        }),
    );
    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent size="compact" ref={content}>
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = capacity.trim();
                        save.mutate({
                            params: { host: host.id },
                            body: {
                                accepts_new: acceptsNew,
                                capacity:
                                    trimmed === '' ? null : Number(trimmed),
                                dedicated,
                                ring,
                            },
                        });
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Pengaturan {host.name}</DialogTitle>
                        <DialogDescription>
                            Menentukan apakah klinik baru boleh ditempatkan di
                            server ini. Lingkungan yang sudah ada di sini tidak
                            terpengaruh.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        <FormGrid columns={1}>
                            <div className="flex items-center justify-between gap-4">
                                <Label htmlFor="accepts-new">
                                    Terima lingkungan baru
                                </Label>
                                <Switch
                                    id="accepts-new"
                                    checked={acceptsNew}
                                    onCheckedChange={setAcceptsNew}
                                />
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <Label htmlFor="dedicated">
                                    Khusus, hanya bila dipilih langsung
                                </Label>
                                <Switch
                                    id="dedicated"
                                    checked={dedicated}
                                    onCheckedChange={setDedicated}
                                />
                            </div>
                            <FormControl
                                error={errors.capacity?.[0]}
                                hint="Jumlah lingkungan paling banyak di server ini. Kosongkan untuk tanpa batas."
                            >
                                <Input
                                    label="Kapasitas"
                                    inputMode="numeric"
                                    value={capacity}
                                    onChange={(event) =>
                                        setCapacity(event.target.value)
                                    }
                                />
                            </FormControl>
                            <FormControl
                                error={errors.ring?.[0]}
                                hint="Urutan host saat versi aplikasi baru dipasang bertahap: host Canary lebih dulu, lalu Early, lalu General."
                            >
                                <Select
                                    label="Release ring"
                                    required
                                    searchPlaceholder="Cari…"
                                    items={(
                                        ['canary', 'early', 'general'] as const
                                    ).map((value) => ({
                                        value,
                                        label: ringLabels[value],
                                    }))}
                                    value={ring}
                                    onValueChange={(value) => {
                                        if (
                                            value === 'canary' ||
                                            value === 'early' ||
                                            value === 'general'
                                        )
                                            setRing(value);
                                    }}
                                    portalContainer={content}
                                />
                            </FormControl>
                            {message && (
                                <p
                                    role="alert"
                                    className="text-sm text-destructive"
                                >
                                    {message}
                                </p>
                            )}
                        </FormGrid>
                    </DialogBody>
                    <DialogFooter>
                        <DialogAction type="submit" disabled={save.isPending}>
                            {save.isPending ? 'Menyimpan…' : 'Simpan'}
                        </DialogAction>
                        <DialogCancel />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function displayTime(value: string): string {
    return new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

// Host baru didaftarkan dari server host itu sendiri lewat CLI, karena kunci privatnya dibuat di sana.
function RuntimeHostsPage(): ReactNode {
    const queryClient = useQueryClient();
    const { confirm, confirmation } = useConfirmation();
    const [editing, setEditing] = useState<Host | null>(null);
    const { data: hosts } = useSuspenseQuery(
        orpc.listRuntimeHosts.queryOptions({
            select: (response) => response.runtime_hosts,
        }),
    );
    const revoke = useMutation(
        orpc.revokeRuntimeHost.mutationOptions({
            onSuccess: async () => {
                toast.success('Host runtime dicabut.');
                await queryClient.invalidateQueries({
                    queryKey: orpc.listRuntimeHosts.key(),
                });
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Host runtime belum dicabut.')),
        }),
    );

    async function askRevoke(host: Host) {
        const bound =
            host.environments > 0
                ? ` Operasi baru untuk ${host.environments} lingkungan yang databasenya ada di host ini tidak akan diambil worker mana pun.`
                : '';
        if (
            await confirm({
                title: `Cabut ${host.name}?`,
                description: `Worker di host ini langsung ditolak, dan operasi yang sedang berjalan gagal setelah tenggatnya lewat.${bound} Host yang dicabut tidak bisa dipakai lagi; daftarkan ulang dengan kunci baru.`,
                confirmLabel: 'Cabut',
                destructive: true,
            })
        )
            revoke.mutate({ params: { host: host.id } });
    }

    return (
        <ListPageLayout header={<RecordActionBar title="Host runtime" />}>
            <DataTable
                data={hosts}
                getRowKey={(host) => host.id}
                getRowLabel={(host) => host.name}
                emptyMessage="Belum ada host runtime. Daftarkan dari server host dengan perintah add-runtime-host."
                actions={[settingsAction, revokeAction]}
                getRowActions={(host) =>
                    host.revoked_at ? [] : [settingsAction, revokeAction]
                }
                onRowAction={(action, host) => {
                    if (action === settingsAction.id) setEditing(host);
                    else void askRevoke(host);
                }}
                columns={[
                    {
                        id: 'name',
                        header: 'Nama',
                        cell: (host) => (
                            <DataTableText>{host.name}</DataTableText>
                        ),
                        sortValue: (host) => host.name,
                        minWidth: 180,
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        cell: (host) => {
                            const badge = availabilityBadge(host.availability);
                            return (
                                <span className="flex flex-wrap items-center gap-1">
                                    <Badge variant={badge.variant}>
                                        {badge.label}
                                    </Badge>
                                    {host.dedicated && (
                                        <Badge variant="outline">Khusus</Badge>
                                    )}
                                </span>
                            );
                        },
                        minWidth: 170,
                    },
                    {
                        id: 'ring',
                        header: 'Release ring',
                        cell: (host) => (
                            <DataTableText>
                                {ringLabels[host.ring]}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'environments',
                        header: 'Lingkungan',
                        cell: (host) => (
                            <DataTableText>
                                {host.capacity === null
                                    ? host.environments
                                    : `${String(host.environments)} / ${String(host.capacity)}`}
                            </DataTableText>
                        ),
                        sortValue: (host) => host.environments,
                    },
                    {
                        id: 'open_operations',
                        header: 'Operasi terbuka',
                        cell: (host) => (
                            <DataTableText>
                                {host.open_operations}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'fingerprint',
                        header: 'Sidik kunci',
                        cell: (host) => (
                            <span
                                className="truncate font-mono text-xs"
                                title={host.fingerprint}
                            >
                                {host.fingerprint.slice(0, 16)}…
                            </span>
                        ),
                        minWidth: 160,
                    },
                    {
                        id: 'reported_release',
                        header: 'Rilis',
                        cell: (host) => (
                            <DataTableText>
                                {host.reported_release ?? 'Belum melapor'}
                            </DataTableText>
                        ),
                        sortValue: (host) => host.reported_release ?? '',
                        minWidth: 140,
                    },
                    {
                        id: 'reported_at',
                        header: 'Laporan terakhir',
                        cell: (host) => (
                            <DataTableText>
                                {host.reported_at
                                    ? displayTime(host.reported_at)
                                    : '-'}
                            </DataTableText>
                        ),
                        sortValue: (host) => host.reported_at ?? '',
                        minWidth: 150,
                    },
                    {
                        id: 'created_at',
                        header: 'Didaftarkan',
                        cell: (host) => (
                            <DataTableText>
                                {displayTime(host.created_at)}
                            </DataTableText>
                        ),
                        sortValue: (host) => host.created_at,
                        minWidth: 150,
                    },
                ]}
            />
            {confirmation}
            {editing && (
                <SettingsDialog
                    host={editing}
                    onOpenChange={(open) => {
                        if (!open) setEditing(null);
                    }}
                />
            )}
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/runtime-hosts',
    layout: 'app',
    title: 'Host runtime',
    component: RuntimeHostsPage,
});
