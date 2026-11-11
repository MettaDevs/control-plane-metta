import { Badge } from '@control-plane-metta/ui/badge';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { displayDate } from '@control-plane-metta/ui/date-picker';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
    definePage,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.portal.ts';
import {
    EnvironmentName,
    environmentStatus,
} from '../customer/environment-labels.tsx';

type Customer = ApiOutput<'listEnvironments'>['customers'][number];
type Tenant = Customer['tenants'][number];
type Row = {
    customer: Customer;
    environment: Tenant['environments'][number];
};

function rowsOf(customers: Customer[]): Row[] {
    return customers.flatMap((customer) =>
        customer.tenants.flatMap((tenant) =>
            tenant.environments.map((environment) => ({
                customer,
                environment,
            })),
        ),
    );
}

// Module yang boleh dipakai setiap klinik. Berlaku untuk semua lingkungan kliniknya, jadi ditulis sekali per klinik
// di atas daftar, bukan di setiap baris.
function ModuleSummary({ customers }: { customers: Customer[] }): ReactNode {
    return (
        <div className="flex flex-col gap-3 px-6 pb-4">
            {customers.flatMap((customer) =>
                customer.tenants.map((tenant) => (
                    <section
                        key={tenant.id}
                        className="flex flex-col gap-2 rounded-lg border p-4"
                    >
                        <h2 className="text-sm font-semibold">
                            {customer.legal_name}
                            {customer.tenants.length > 1 && (
                                <span className="font-normal text-muted-foreground">
                                    {' '}
                                    ({tenant.name})
                                </span>
                            )}
                        </h2>
                        {tenant.modules.length ? (
                            <ul className="flex flex-wrap gap-2">
                                {tenant.modules.map((module) => (
                                    <li key={module.id}>
                                        <Badge variant="secondary">
                                            {module.name}
                                            {module.ends_on &&
                                                ` · sampai ${displayDate(module.ends_on)}`}
                                        </Badge>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                Belum ada module yang aktif.
                            </p>
                        )}
                    </section>
                )),
            )}
        </div>
    );
}

function EnvironmentsPage(): ReactNode {
    const { data: customers } = useSuspenseQuery(
        orpc.listEnvironments.queryOptions({
            select: (response) => response.customers,
        }),
    );

    return (
        <ListPageLayout
            header={
                <>
                    <RecordActionBar title="Lingkungan" />
                    <ModuleSummary customers={customers} />
                </>
            }
        >
            <DataTable
                data={rowsOf(customers)}
                getRowKey={(row) => row.environment.id}
                getRowLabel={(row) => row.environment.name}
                emptyMessage="Belum ada lingkungan. Lingkungan muncul di sini begitu selesai disiapkan."
                columns={[
                    {
                        id: 'customer',
                        header: 'Klinik',
                        cell: (row) => (
                            <DataTableText>
                                {row.customer.legal_name}
                            </DataTableText>
                        ),
                        sortValue: (row) => row.customer.legal_name,
                        minWidth: 200,
                    },
                    {
                        id: 'environment',
                        header: 'Lingkungan',
                        cell: (row) => (
                            <EnvironmentName environment={row.environment} />
                        ),
                        minWidth: 160,
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        cell: (row) => {
                            const status = environmentStatus(
                                row.environment.status,
                            );
                            return (
                                <Badge variant={status.variant}>
                                    {status.label}
                                </Badge>
                            );
                        },
                    },
                    {
                        id: 'address',
                        header: 'Alamat',
                        cell: (row) =>
                            row.environment.address ? (
                                <a
                                    href={row.environment.address}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm text-primary underline-offset-4 hover:underline"
                                >
                                    {row.environment.address.replace(
                                        /^https?:\/\//,
                                        '',
                                    )}
                                </a>
                            ) : (
                                <DataTableText>-</DataTableText>
                            ),
                        minWidth: 240,
                    },
                    {
                        id: 'expires_at',
                        header: 'Berlaku sampai',
                        cell: (row) => (
                            <DataTableText>
                                {row.environment.expires_at
                                    ? displayDate(row.environment.expires_at)
                                    : 'Tanpa batas'}
                            </DataTableText>
                        ),
                        sortValue: (row) => row.environment.expires_at ?? '',
                    },
                ]}
            />
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/',
    layout: 'app',
    title: 'Lingkungan',
    component: EnvironmentsPage,
});
