import { Badge } from '@control-plane-metta/ui/badge';
import { Button } from '@control-plane-metta/ui/button';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { displayDate } from '@control-plane-metta/ui/date-picker';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
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

type Tenant = ApiOutput<'listEnvironments'>['tenant'];

// Module yang boleh dipakai klinik aktif. Berlaku untuk semua lingkungannya, jadi ditulis sekali di atas daftar, bukan
// di setiap baris.
function ModuleSummary({ tenant }: { tenant: Tenant }): ReactNode {
    return (
        <div className="px-6 pb-4">
            <section className="flex flex-col gap-2 rounded-lg border p-4">
                <h2 className="text-sm font-semibold">Module aktif</h2>
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
        </div>
    );
}

function EnvironmentsPage(): ReactNode {
    const { data: tenant } = useSuspenseQuery(
        orpc.listEnvironments.queryOptions({
            select: (response) => response.tenant,
        }),
    );

    return (
        <ListPageLayout
            header={
                <>
                    <RecordActionBar title="Lingkungan" />
                    <ModuleSummary tenant={tenant} />
                </>
            }
        >
            <DataTable
                data={tenant.environments}
                getRowKey={(environment) => environment.id}
                getRowLabel={(environment) => environment.name}
                emptyMessage="Belum ada lingkungan. Lingkungan muncul di sini begitu selesai disiapkan."
                columns={[
                    {
                        id: 'environment',
                        header: 'Lingkungan',
                        cell: (environment) => (
                            <EnvironmentName environment={environment} />
                        ),
                        minWidth: 160,
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        cell: (environment) => {
                            const status = environmentStatus(
                                environment.status,
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
                        cell: (environment) => (
                            <DataTableText>
                                {environment.address?.replace(
                                    /^https?:\/\//,
                                    '',
                                ) ?? '-'}
                            </DataTableText>
                        ),
                        minWidth: 240,
                    },
                    {
                        id: 'expires_at',
                        header: 'Berlaku sampai',
                        cell: (environment) => (
                            <DataTableText>
                                {environment.expires_at
                                    ? displayDate(environment.expires_at)
                                    : 'Tanpa batas'}
                            </DataTableText>
                        ),
                        sortValue: (environment) =>
                            environment.expires_at ?? '',
                    },
                    {
                        // Masuk lewat SSO klinik: akun yang sudah login di penyedia SSO langsung masuk tanpa mengetik
                        // password lagi.
                        id: 'open',
                        header: '',
                        cell: (environment) =>
                            environment.address &&
                            environment.status === 'active' ? (
                                <Button variant="outline" size="sm" asChild>
                                    <a
                                        href={`${environment.address}/sso/start`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        <ExternalLink />
                                        Buka
                                    </a>
                                </Button>
                            ) : null,
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
