import { Building2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Menu konsol. Setiap operator memegang akses yang sama, jadi menunya ditulis di sini dan tidak disaring server.
// Hanya halaman yang sudah ada yang masuk menu.
export type NavigationGroup = {
    id: string;
    label: string;
    href: string;
    icon: LucideIcon;
    items: { id: string; label: string; href: string }[];
};

export const homePath = '/customers';

export const navigation: NavigationGroup[] = [
    {
        id: 'customers',
        label: 'Customer',
        href: '/customers',
        icon: Building2,
        items: [
            { id: 'customers', label: 'Daftar customer', href: '/customers' },
            {
                id: 'new-customer',
                label: 'Customer baru',
                href: '/customers/new',
            },
        ],
    },
];
