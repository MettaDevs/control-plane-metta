import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { definePage, orpc } from '../../platform/shell/index.ts';

// Module dilaporkan host runtime, jadi daftar ini hanya dibaca. Hak module diberikan dari detail customer.
function ModulesPage(): ReactNode {
    const { data: modules } = useSuspenseQuery(
        orpc.listModuleCatalog.queryOptions({
            select: (response) => response.modules,
        }),
    );
    return (
        <ListPageLayout header={<RecordActionBar title="Module" />}>
            <DataTable
                data={modules}
                getRowKey={(module) => module.id}
                getRowLabel={(module) => module.name}
                emptyMessage="Belum ada module. Module muncul setelah host runtime melaporkannya."
                columns={[
                    {
                        id: 'name',
                        header: 'Module',
                        cell: (module) => (
                            <DataTableText>{module.name}</DataTableText>
                        ),
                        minWidth: 180,
                    },
                    {
                        id: 'description',
                        header: 'Deskripsi',
                        cell: (module) => (
                            <DataTableText>
                                {module.description ?? '-'}
                            </DataTableText>
                        ),
                        minWidth: 260,
                    },
                    {
                        id: 'hosts',
                        header: 'Host yang membawanya',
                        cell: (module) => (
                            <DataTableText>
                                {module.hosts.length
                                    ? module.hosts.join(', ')
                                    : 'Tidak ada host aktif'}
                            </DataTableText>
                        ),
                        minWidth: 200,
                    },
                ]}
            />
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/catalog/modules',
    layout: 'app',
    title: 'Module',
    component: ModulesPage,
});
