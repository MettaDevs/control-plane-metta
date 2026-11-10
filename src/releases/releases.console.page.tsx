import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { definePage, orpc } from '../platform/shell/index.ts';

// Rilis didaftarkan pipeline rilis dengan tanda tangan, bukan dari konsol, jadi layar ini hanya membaca.
function ReleasesPage(): ReactNode {
    const { data: releases } = useSuspenseQuery(
        orpc.listReleases.queryOptions({
            select: (response) => response.releases,
        }),
    );

    return (
        <ListPageLayout header={<RecordActionBar title="Rilis" />}>
            <DataTable
                data={releases}
                getRowKey={(release) => `${release.edition}/${release.release}`}
                emptyMessage="Belum ada rilis terdaftar."
                columns={[
                    {
                        id: 'edition',
                        header: 'Edisi',
                        cell: (release) => (
                            <DataTableText>{release.edition}</DataTableText>
                        ),
                        sortValue: (release) => release.edition,
                    },
                    {
                        id: 'release',
                        header: 'Rilis',
                        cell: (release) => (
                            <DataTableText>{release.release}</DataTableText>
                        ),
                    },
                    {
                        id: 'image',
                        header: 'Image',
                        cell: (release) => (
                            <DataTableText>{release.image}</DataTableText>
                        ),
                        minWidth: 280,
                    },
                    {
                        id: 'registered_at',
                        header: 'Didaftarkan',
                        cell: (release) => (
                            <DataTableText>
                                {new Intl.DateTimeFormat('id-ID', {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                }).format(new Date(release.registered_at))}
                            </DataTableText>
                        ),
                        sortValue: (release) => release.registered_at,
                        minWidth: 160,
                    },
                ]}
            />
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/releases',
    layout: 'app',
    title: 'Rilis',
    component: ReleasesPage,
});
