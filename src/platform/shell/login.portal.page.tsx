import { Alert, AlertDescription } from '@control-plane-metta/ui/alert';
import { Button } from '@control-plane-metta/ui/button';
import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { AuthCard } from './auth-layout.tsx';
import { definePage } from './page.ts';

const route = getRouteApi('/_auth/login');

// Alasan kegagalan yang dikirim /sso/callback dan /sso/start lewat `?portal_error=`.
function errorMessage(reason: string): string {
    switch (reason) {
        case 'not-linked':
            return 'Akun ini belum punya akses ke portal. Buka tautan undangan dari email Anda, lalu masuk dengan akun yang ingin dipakai.';
        case 'invitation-invalid':
            return 'Tautan undangan ini sudah tidak berlaku. Mungkin sudah dipakai, dibatalkan, atau lewat masa berlakunya. Minta undangan baru kepada pihak yang mengundang Anda.';
        case 'invalid-ceremony':
            return 'Proses masuk sudah kedaluwarsa atau terputus. Silakan coba lagi.';
        case 'provider-unreachable':
            return 'Layanan login sedang tidak dapat dihubungi. Coba lagi sebentar lagi.';
        default:
            return 'Belum berhasil masuk. Silakan coba lagi.';
    }
}

function LoginPage(): ReactNode {
    const search = route.useSearch();
    return (
        <AuthCard
            title="Masuk ke portal klinik"
            description="Gunakan akun SSO yang Anda pakai saat menerima undangan."
        >
            <div className="flex flex-col gap-6">
                {search.portal_error && (
                    <Alert variant="destructive">
                        <AlertDescription>
                            {errorMessage(search.portal_error)}
                        </AlertDescription>
                    </Alert>
                )}
                {/* Navigasi penuh: /sso/start dijawab server dengan pengalihan ke halaman login SSO. */}
                <Button asChild className="w-full">
                    <a href="/sso/start">Masuk dengan SSO</a>
                </Button>
            </div>
        </AuthCard>
    );
}

export const page = definePage({
    path: '/login',
    layout: 'auth',
    title: 'Masuk',
    validateSearch: z.object({
        portal_error: z.string().optional().catch(undefined),
    }),
    component: LoginPage,
});
