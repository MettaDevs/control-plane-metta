import { Avatar, AvatarFallback } from '@control-plane-metta/ui/avatar';
import {
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@control-plane-metta/ui/dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText } from './api.ts';
import type { Operator } from './api.ts';

export function initials(fullName: string): string {
    const names = fullName.trim().split(/\s+/u).filter(Boolean);
    const first = names[0];
    const last = names.at(-1);
    if (!first || !last) return '';
    const initial = (name: string) => Array.from(name)[0] ?? '';
    return (
        names.length === 1 ? initial(first) : initial(first) + initial(last)
    ).toUpperCase();
}

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

// Isi menu profil di header. Layar 2FA dan tautan SSO belum ada; keduanya masih lewat API.
export function UserMenuContent({ operator }: { operator: Operator }) {
    const queryClient = useQueryClient();

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
