import { Card, CardContent, CardHeader } from '@control-plane-metta/ui/card';
import { Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useDocumentTitle } from './use-document-title.ts';

// Bingkai halaman sebelum login, dipindah dari auth-simple-layout CoreERP, tanpa logo merek di atas kartu.
export function AuthLayout(): ReactNode {
    useDocumentTitle(null);

    return (
        <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 sm:px-6">
            <div className="flex w-full max-w-md flex-col gap-6">
                <Outlet />
            </div>
        </main>
    );
}

// Kartu halaman sebelum login: judul dan keterangan di atas isinya.
export function AuthCard({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <Card>
            <CardHeader>
                <div className="flex w-full flex-col gap-2 text-center">
                    <h1 className="text-xl font-semibold">{title}</h1>
                    {description && (
                        <p className="text-sm text-balance text-muted-foreground">
                            {description}
                        </p>
                    )}
                </div>
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}
