import { Avatar, AvatarFallback } from '@control-plane-metta/ui/avatar';
import {
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@control-plane-metta/ui/dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, Link2Off, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { errorText } from './api-client.ts';
import { api, meQuery } from './api.ts';
import type { Operator } from './api.ts';
import { initials } from './initials.ts';

export function UserInfo({ operator }: { operator: Operator }) {
    return (
        <>
            <Avatar className="h-8 w-8 overflow-hidden rounded-full">
                <AvatarFallback className="rounded-lg bg-neutral-200 text-black dark:bg-neutral-700 dark:text-white">
                    {initials(operator.name)}
                </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{operator.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                    {operator.email}
                </span>
            </div>
        </>
    );
}

// Isi menu profil di header. Layar 2FA belum ada dan masih lewat API.
export function UserMenuContent({
    operator,
    sso,
    onLinkSso,
}: {
    operator: Operator;
    sso: { linked: boolean; has_password: boolean } | null;
    onLinkSso: () => void;
}) {
    const queryClient = useQueryClient();

    const unlink = async () => {
        try {
            await api.ssoUnlink();
        } catch (caught) {
            toast.error(errorText(caught, 'Tautan SSO belum dilepas.'));
            return;
        }
        toast.success('Tautan SSO dilepas. Login berikutnya memakai password.');
        await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    };

    const logout = async () => {
        try {
            await api.logout();
        } catch (caught) {
            toast.error(errorText(caught, 'Belum berhasil keluar.'));
            return;
        }
        queryClient.clear();
        // Muat ulang penuh supaya tidak ada data sesi sebelumnya yang tertinggal di layar.
        window.location.assign('/login');
    };

    return (
        <>
            <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <UserInfo operator={operator} />
                </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sso && !sso.linked && sso.has_password && (
                <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={onLinkSso}
                >
                    <Link2 className="mr-2" />
                    Tautkan akun SSO
                </DropdownMenuItem>
            )}
            {sso?.linked && sso.has_password && (
                <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={() => void unlink()}
                >
                    <Link2Off className="mr-2" />
                    Lepas tautan SSO
                </DropdownMenuItem>
            )}
            <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => void logout()}
                data-test="logout-button"
            >
                <LogOut className="mr-2" />
                Keluar
            </DropdownMenuItem>
        </>
    );
}
