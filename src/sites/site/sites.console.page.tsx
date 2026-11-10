import { Badge } from '@control-plane-metta/ui/badge';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage, orpc } from '../../platform/shell/index.ts';
import { displayTime, siteState } from './site-labels.tsx';

function SitesPage(): ReactNode {
    const navigate = useNavigate();
    const { data: sites } = useSuspenseQuery(
        orpc.listSites.queryOptions({
            select: (response) => response.sites,
        }),
    );

    return (
        <ListPageLayout header={<RecordActionBar title="Server klien" />}>
            <DataTable
                data={sites}
                getRowKey={(site) => site.id}
                getRowLabel={(site) => site.name}
                rowActivation="single-click"
                onRowClick={(site) =>
                    void navigate({
                        to: '/sites/$site',
                        params: { site: site.id },
                    })
                }
                emptyMessage="Belum ada server klien yang terdaftar."
                columns={[
                    {
                        id: 'name',
                        header: 'Nama',
                        cell: (site) => (
                            <DataTableText>{site.name}</DataTableText>
                        ),
                        sortValue: (site) => site.name,
                        minWidth: 180,
                    },
                    {
                        id: 'tenant',
                        header: 'Klinik',
                        cell: (site) => (
                            <DataTableText>{site.tenant_name}</DataTableText>
                        ),
                        sortValue: (site) => site.tenant_name,
                        minWidth: 180,
                    },
                    {
                        id: 'state',
                        header: 'Status',
                        cell: (site) => {
                            const state = siteState(site.state);
                            return (
                                <Badge variant={state.variant}>
                                    {state.label}
                                </Badge>
                            );
                        },
                    },
                    {
                        id: 'release',
                        header: 'Rilis terpasang',
                        cell: (site) => (
                            <DataTableText>
                                {site.reported_release ?? '-'}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'last_seen_at',
                        header: 'Laporan terakhir',
                        cell: (site) => (
                            <DataTableText>
                                {displayTime(site.last_seen_at)}
                            </DataTableText>
                        ),
                        sortValue: (site) => site.last_seen_at ?? '',
                        minWidth: 160,
                    },
                ]}
            />
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/sites',
    layout: 'app',
    title: 'Server klien',
    component: SitesPage,
});
