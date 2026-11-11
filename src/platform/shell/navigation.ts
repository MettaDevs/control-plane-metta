import { Blocks, Building2, Cpu, Package, Server } from 'lucide-react';
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
    {
        id: 'catalog',
        label: 'Katalog',
        href: '/catalog',
        icon: Blocks,
        items: [{ id: 'catalog', label: 'Module', href: '/catalog' }],
    },
    {
        id: 'sites',
        label: 'Server klien',
        href: '/sites',
        icon: Server,
        items: [{ id: 'sites', label: 'Daftar server klien', href: '/sites' }],
    },
    {
        id: 'runtime-hosts',
        label: 'Host runtime',
        href: '/runtime-hosts',
        icon: Cpu,
        items: [
            {
                id: 'runtime-hosts',
                label: 'Daftar host runtime',
                href: '/runtime-hosts',
            },
        ],
    },
    {
        id: 'releases',
        label: 'Rilis',
        href: '/releases',
        icon: Package,
        items: [{ id: 'releases', label: 'Daftar rilis', href: '/releases' }],
    },
];
