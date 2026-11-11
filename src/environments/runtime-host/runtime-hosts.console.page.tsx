import { Badge } from '@control-plane-metta/ui/badge';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    definePage,
    errorText,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type Host = ApiOutput<'listRuntimeHosts'>['runtime_hosts'][number];

const revokeAction = {
    id: 'revoke',
    label: 'Cabut',
    destructive: true,
};

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
                actions={[revokeAction]}
                getRowActions={(host) =>
                    host.revoked_at ? [] : [revokeAction]
                }
                onRowAction={(_action, host) => void askRevoke(host)}
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
                        cell: (host) =>
                            host.revoked_at ? (
                                <Badge variant="outline">Dicabut</Badge>
                            ) : (
                                <Badge>Aktif</Badge>
                            ),
                    },
                    {
                        id: 'environments',
                        header: 'Lingkungan',
                        cell: (host) => (
                            <DataTableText>{host.environments}</DataTableText>
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
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/runtime-hosts',
    layout: 'app',
    title: 'Host runtime',
    component: RuntimeHostsPage,
});
