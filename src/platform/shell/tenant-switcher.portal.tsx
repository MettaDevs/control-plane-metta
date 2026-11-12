import { Button } from '@control-plane-metta/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@control-plane-metta/ui/dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { errorText } from './api-client.ts';
import { api, type ApiOutput } from './api.portal.ts';

type Me = ApiOutput<'me'>;
type Tenant = Me['tenants'][number];

function groupByCustomer(tenants: Tenant[]) {
    const groups = new Map<
        string,
        { clientId: string; legalName: string; tenants: Tenant[] }
    >();
    for (const tenant of tenants) {
        const group = groups.get(tenant.client_id) ?? {
            clientId: tenant.client_id,
            legalName: tenant.legal_name,
            tenants: [],
        };
        group.tenants.push(tenant);
        groups.set(tenant.client_id, group);
    }
    return [...groups.values()];
}

// Klinik yang sedang dibuka di portal, di pojok kanan atas, dengan daftar setiap klinik yang bisa dibuka akun ini.
// Pilihan disimpan server di cookie dan diperiksa ulang setiap request.
export function TenantSwitcher({ me }: { me: Me }): ReactNode {
    const queryClient = useQueryClient();
    const [pending, setPending] = useState(false);
    const active = me.tenants.find(
        (tenant) => tenant.id === me.active_tenant_id,
    );
    const groups = groupByCustomer(me.tenants);
    const several = groups.length > 1;

    const choose = async (tenantId: string) => {
        if (tenantId === me.active_tenant_id) return;
        setPending(true);
        try {
            await api.chooseTenant({ body: { tenant_id: tenantId } });
            // Semua data portal milik klinik aktif, jadi semuanya dimuat ulang.
            await queryClient.invalidateQueries();
        } catch (caught) {
            toast.error(errorText(caught, 'Klinik belum berhasil diganti.'));
        } finally {
            setPending(false);
        }
    };

    if (!active) return null;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="max-w-64"
                    disabled={pending}
                    aria-label={`Klinik aktif: ${active.name}. Ganti klinik`}
                >
                    <Building2 />
                    <span className="truncate">{active.name}</span>
                    {me.tenants.length > 1 && <ChevronDown />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-64 rounded-lg" align="end">
                <DropdownMenuRadioGroup
                    value={active.id}
                    onValueChange={(value) => void choose(value)}
                >
                    {groups.map((group, index) => (
                        <Fragment key={group.clientId}>
                            {index > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuGroup>
                                <DropdownMenuLabel className="text-xs text-muted-foreground">
                                    {several ? group.legalName : 'Klinik'}
                                </DropdownMenuLabel>
                                {group.tenants.map((tenant) => (
                                    <DropdownMenuRadioItem
                                        key={tenant.id}
                                        value={tenant.id}
                                        className="cursor-pointer"
                                    >
                                        <span className="truncate">
                                            {tenant.name}
                                        </span>
                                        {tenant.is_admin && (
                                            <span className="ml-auto pl-2 text-xs text-muted-foreground">
                                                Admin
                                            </span>
                                        )}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuGroup>
                        </Fragment>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
