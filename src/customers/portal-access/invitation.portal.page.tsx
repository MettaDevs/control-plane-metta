import { Button } from '@control-plane-metta/ui/button';
import { Spinner } from '@control-plane-metta/ui/spinner';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    ApiError,
    AuthCard,
    definePage,
    errorText,
    orpc,
} from '../../platform/shell/index.portal.ts';

const route = getRouteApi('/_auth/invitation');

const invalidText =
    'Undangan ini sudah tidak berlaku. Mungkin sudah dipakai, dibatalkan, atau lewat masa berlakunya. Minta undangan baru kepada pihak yang mengundang Anda.';

// Halaman tujuan tautan di email undangan. Akun SSO yang dipakai untuk masuk dari sini tersambung ke klinik pengundang;
// tautan itulah buktinya, bukan kecocokan email.
function InvitationPage(): ReactNode {
    const { token } = route.useSearch();
    const invitation = useQuery({
        ...orpc.showInvitation.queryOptions({
            input: { query: { token: token ?? '' } },
        }),
        enabled: Boolean(token),
    });

    if (!token)
        return (
            <AuthCard title="Undangan tidak lengkap">
                <p className="text-sm text-muted-foreground">
                    Buka tautan undangan persis seperti yang ada di email Anda.
                </p>
            </AuthCard>
        );
    if (invitation.isPending)
        return (
            <AuthCard title="Memeriksa undangan">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner /> Memuat…
                </div>
            </AuthCard>
        );
    if (invitation.isError)
        return (
            <AuthCard title="Undangan tidak dapat dipakai">
                <p className="text-sm" role="alert">
                    {invitation.error instanceof ApiError &&
                    invitation.error.status === 404
                        ? invalidText
                        : errorText(
                              invitation.error,
                              'Undangan belum dapat diperiksa.',
                          )}
                </p>
            </AuthCard>
        );
    if (!invitation.data.usable)
        return (
            <AuthCard title="Undangan tidak dapat dipakai">
                <p className="text-sm" role="alert">
                    {invalidText}
                </p>
                <Button asChild variant="outline" className="mt-6 w-full">
                    <a href="/login">Ke halaman masuk</a>
                </Button>
            </AuthCard>
        );
    return (
        <AuthCard
            title="Undangan portal klinik"
            description={`Anda diundang untuk mengelola ${invitation.data.legal_name} lewat portal ini.`}
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                    Masuk dengan akun SSO untuk menerima undangan. Akun yang
                    Anda pakai akan tersambung ke {invitation.data.legal_name},
                    dan berikutnya Anda cukup masuk dengan akun yang sama.
                </p>
                {/* Navigasi penuh: /sso/start memeriksa undangan lalu membawa ke halaman login SSO. */}
                <Button asChild className="w-full">
                    <a
                        href={`/sso/start?invitation=${encodeURIComponent(token)}`}
                    >
                        Terima dan masuk dengan SSO
                    </a>
                </Button>
            </div>
        </AuthCard>
    );
}

export const page = definePage({
    path: '/invitation',
    layout: 'auth',
    title: 'Undangan',
    validateSearch: z.object({
        token: z.string().optional().catch(undefined),
    }),
    component: InvitationPage,
});
