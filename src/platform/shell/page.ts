import type { ReactNode } from 'react';
import type { z } from 'zod';

declare module '@tanstack/react-router' {
    interface StaticDataRouteOption {
        // Judul halaman di tab peramban.
        title?: string;
    }
}

/**
 * Satu layar. Berkasnya bernama `<fitur>.console.page.tsx` di folder fiturnya dan meng-export `page`:
 *
 * ```tsx
 * export const page = definePage({
 *     path: '/customers',
 *     layout: 'app',
 *     title: 'Customer',
 *     component: CustomersPage,
 * });
 * ```
 *
 * `path` adalah URL layar dan ditulis sebagai teks literal, karena scripts/generate-client.ts membacanya tanpa
 * menjalankan halaman. Nama dan folder berkas tidak menentukan URL. `layout: 'app'` memasang halaman di dalam Shell dan
 * mewajibkan login; `'auth'` untuk halaman sebelum login. `validateSearch` (schema zod) memeriksa search params
 * halaman; di dalam komponen, `getRouteApi(path).useSearch()` memberi nilainya dengan tipe dari schema itu.
 */
export function definePage<
    const TPath extends `/${string}`,
    TSearch extends z.ZodType | undefined = undefined,
>(page: {
    path: TPath;
    layout: 'app' | 'auth';
    title: string;
    validateSearch?: TSearch;
    component: () => ReactNode;
}) {
    return page;
}
