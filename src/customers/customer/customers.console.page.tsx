import { ActionButton } from '@control-plane-metta/ui/action-button';
import { Badge } from '@control-plane-metta/ui/badge';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { displayDate } from '@control-plane-metta/ui/date-picker';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
    definePage,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';
import {
    EnvironmentName,
    environmentStatus,
    OperationCell,
} from './environment-labels.tsx';
import { NewCustomerCard } from './new-customer-card.tsx';

type Customer = ApiOutput<'listCustomers'>['customers'][number];
type Environment = Customer['environments'][number];
type Operation = NonNullable<Environment['operation']>;

// Satu baris per lingkungan, supaya status dan operasi terakhir setiap lingkungan terbaca sejajar. Customer tanpa
// lingkungan tetap tampil satu baris.
type Row = { customer: Customer; environment: Environment | null };

const openStatuses: ReadonlySet<Operation['status']> = new Set([
    'requested',
    'running',
]);

// Selama ada operasi yang belum ditutup worker, daftar dibaca ulang supaya kemajuannya terlihat tanpa memuat ulang.
const refreshMs = 3000;

function rowsOf(customers: Customer[]): Row[] {
    return customers.flatMap((customer): Row[] =>
        customer.environments.length
            ? customer.environments.map((environment) => ({
                  customer,
                  environment,
              }))
            : [{ customer, environment: null }],
    );
}

function hasOpenOperation(customers: Customer[]): boolean {
    return customers.some((customer) =>
        customer.environments.some(
            (environment) =>
                environment.operation !== null &&
                openStatuses.has(environment.operation.status),
        ),
    );
}

function CustomersPage(): ReactNode {
    const navigate = useNavigate();
    const [creating, setCreating] = useState(false);
    const { data: customers } = useSuspenseQuery(
        orpc.listCustomers.queryOptions({
            select: (response) => response.customers,
            refetchInterval: (query) =>
                query.state.data && hasOpenOperation(query.state.data.customers)
                    ? refreshMs
                    : false,
        }),
    );

    return (
        <ListPageLayout
            header={
                <RecordActionBar title="Customer">
                    <ActionButton
                        action="create"
                        onClick={() => setCreating(true)}
                    />
                </RecordActionBar>
            }
        >
            <DataTable
                data={rowsOf(customers)}
                getRowKey={(row) =>
                    row.environment?.id ?? row.customer.client_id
                }
                getRowLabel={(row) => row.customer.legal_name}
                rowActivation="single-click"
                onRowClick={(row) =>
                    void navigate({
                        to: '/customers/$client',
                        params: { client: row.customer.client_id },
                    })
                }
                emptyMessage="Belum ada customer. Pilih Baru untuk membuat customer pertama."
                columns={[
                    {
                        id: 'legal_name',
                        header: 'Tenant',
                        cell: (row) => (
                            <DataTableText>
                                {row.customer.legal_name}
                            </DataTableText>
                        ),
                        sortValue: (row) => row.customer.legal_name,
                        minWidth: 200,
                    },
                    {
                        id: 'slug',
                        header: 'Slug',
                        cell: (row) => (
                            <DataTableText>{row.customer.slug}</DataTableText>
                        ),
                        sortValue: (row) => row.customer.slug,
                    },
                    {
                        id: 'environment',
                        header: 'Lingkungan',
                        cell: (row) =>
                            row.environment ? (
                                <div className="flex min-w-0 flex-col gap-0.5 py-1 text-sm">
                                    <EnvironmentName
                                        environment={row.environment}
                                    />
                                    {row.environment.expires_at && (
                                        <span className="text-xs text-muted-foreground">
                                            Berakhir{' '}
                                            {displayDate(
                                                row.environment.expires_at,
                                            )}
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <DataTableText>Belum ada</DataTableText>
                            ),
                        minWidth: 160,
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        cell: (row) => {
                            if (!row.environment)
                                return <DataTableText>-</DataTableText>;
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
                        id: 'operation',
                        header: 'Operasi terakhir',
                        cell: (row) => (
                            <OperationCell
                                operation={row.environment?.operation ?? null}
                            />
                        ),
                        minWidth: 220,
                    },
                ]}
            />
            {creating && <NewCustomerCard onClose={() => setCreating(false)} />}
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/customers',
    layout: 'app',
    title: 'Customer',
    component: CustomersPage,
});
