import {
    Dialog,
    DialogAction,
    DialogBody,
    DialogCancel,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@control-plane-metta/ui/dialog';
import { FormControl, FormGrid } from '@control-plane-metta/ui/form-control';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { api, ApiError, errorText } from './api.ts';
import { PasswordInput } from './password-input.tsx';

// Alasan yang dikirim /sso/callback lewat `?sso_error=` sesudah upacara tautan gagal.
function linkErrorText(reason: string): string {
    switch (reason) {
        case 'already-linked':
            return 'Akun SSO ini sudah tertaut ke operator lain, atau akun Anda sudah tertaut ke akun SSO lain.';
        case 'invalid-ceremony':
            return 'Penautan SSO kedaluwarsa atau tidak lengkap. Coba lagi.';
        default:
            return 'Akun SSO belum tertaut. Coba lagi.';
    }
}

// Hasil penautan datang sebagai query di alamat tujuan /sso/callback. Ditampilkan sekali, lalu query-nya dibuang supaya
// tidak muncul lagi saat halaman dimuat ulang.
export function useSsoLinkNotice(): void {
    useEffect(() => {
        const url = new URL(window.location.href);
        const linked = url.searchParams.get('sso');
        const failed = url.searchParams.get('sso_error');
        if (!linked && !failed) return;
        if (linked === 'linked')
            toast.success(
                'Akun SSO tertaut. Berikutnya Anda bisa login dengan SSO.',
            );
        if (failed) toast.error(linkErrorText(failed));
        url.searchParams.delete('sso');
        url.searchParams.delete('sso_error');
        window.history.replaceState(null, '', url);
    }, []);
}

// Password diketik ulang sebelum peramban dibawa ke penyedia SSO; tautannya dibuat di /sso/callback.
export function SsoLinkDialog({
    onOpenChange,
}: {
    onOpenChange: (open: boolean) => void;
}): ReactNode {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent size="compact">
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        setBusy(true);
                        setError(null);
                        api.ssoLink({ body: { password } }).then(
                            (response) =>
                                window.location.assign(response.authorize_url),
                            (caught: unknown) => {
                                setBusy(false);
                                setError(
                                    caught instanceof ApiError &&
                                        caught.status === 422
                                        ? 'Password tidak cocok.'
                                        : errorText(
                                              caught,
                                              'Penautan SSO belum bisa dimulai.',
                                          ),
                                );
                            },
                        );
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Tautkan akun SSO</DialogTitle>
                        <DialogDescription>
                            Ketik ulang password konsol Anda. Setelah itu Anda
                            dibawa ke halaman login SSO, dan akun SSO yang
                            dipakai di sana tertaut ke akun konsol ini.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        <FormGrid columns={1}>
                            <FormControl error={error ?? undefined}>
                                <PasswordInput
                                    label="Password"
                                    required
                                    autoFocus
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(event) =>
                                        setPassword(event.target.value)
                                    }
                                />
                            </FormControl>
                        </FormGrid>
                    </DialogBody>
                    <DialogFooter>
                        <DialogAction type="submit" disabled={busy}>
                            {busy ? 'Membuka SSO…' : 'Lanjut ke SSO'}
                        </DialogAction>
                        <DialogCancel />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
