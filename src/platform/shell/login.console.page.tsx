import { Button } from '@control-plane-metta/ui/button';
import { Input } from '@control-plane-metta/ui/input';
import { Spinner } from '@control-plane-metta/ui/spinner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { ApiError, errorText, orpc } from './api.ts';
import { AuthCard } from './auth-layout.tsx';
import { FormErrorHeader } from './form-error-header.tsx';
import { homePath } from './navigation.ts';
import { definePage } from './page.ts';
import { PasswordInput } from './password-input.tsx';

// Id route = id layout + path, seperti layout tanpa path di TanStack Router: `/_auth/login`.
const route = getRouteApi('/_auth/login');

// Hanya alamat di konsol ini, supaya tautan login tidak bisa dipakai untuk membawa operator ke situs lain.
function destination(redirect: string | undefined): string {
    return redirect?.startsWith('/') &&
        !redirect.startsWith('//') &&
        !redirect.startsWith('/\\')
        ? redirect
        : homePath;
}

// Alasan kegagalan yang dikirim /sso/callback lewat `?sso_error=`.
function ssoErrorText(reason: string): string {
    switch (reason) {
        case 'not-linked':
            return 'Akun SSO ini belum ditautkan ke operator mana pun. Login dengan email dan password, lalu tautkan akun SSO Anda.';
        case 'invalid-ceremony':
            return 'Login SSO sudah kedaluwarsa atau tidak lengkap. Coba lagi.';
        case 'provider-unreachable':
            return 'Penyedia SSO tidak dapat dihubungi. Coba lagi sebentar lagi, atau login dengan email dan password.';
        default:
            return 'Login SSO belum berhasil. Coba lagi, atau login dengan email dan password.';
    }
}

type Step = 'password' | 'two-factor';

// Login operator di atas POST /login dan POST /login/two-factor. Bila 2FA aktif, password yang benar hanya membuka
// langkah kode; sesi baru diberikan sesudah kode cocok. Login SSO kembali ke `/login?two_factor=1` bila operatornya
// memakai 2FA.
function LoginPage(): ReactNode {
    const search = route.useSearch();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const options = useQuery(orpc.loginOptions.queryOptions());
    const [step, setStep] = useState<Step>(
        search.two_factor ? 'two-factor' : 'password',
    );
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(
        search.sso_error ? ssoErrorText(search.sso_error) : null,
    );

    const enter = async () => {
        queryClient.clear();
        await navigate({ href: destination(search.redirect) });
    };
    const fail = (caught: Error, fallback: string) => {
        if (caught instanceof ApiError && caught.status === 422)
            setErrors(caught.errors);
        else setMessage(errorText(caught, fallback));
    };
    const reset = () => {
        setErrors({});
        setMessage(null);
    };

    const login = useMutation(
        orpc.login.mutationOptions({
            onMutate: reset,
            onSuccess: async (response) => {
                if ('two_factor_required' in response) {
                    setStep('two-factor');
                    return;
                }
                await enter();
            },
            onError: (caught) => fail(caught, 'Belum berhasil login.'),
        }),
    );
    const verify = useMutation(
        orpc.loginTwoFactor.mutationOptions({
            onMutate: reset,
            onSuccess: enter,
            onError: (caught) => {
                // Cookie tunggu lima menit sudah habis: mulai lagi dari password.
                if (caught instanceof ApiError && caught.status === 401) {
                    setStep('password');
                    setMessage(
                        'Waktu memasukkan kode sudah habis. Login lagi dengan email dan password.',
                    );
                    return;
                }
                fail(caught, 'Kode belum berhasil diperiksa.');
            },
        }),
    );

    if (step === 'two-factor')
        return (
            // key: isian email tidak boleh terbawa ke field kode, karena React memakai ulang elemen di posisi yang sama.
            <AuthCard
                key="two-factor"
                title="Masukkan kode verifikasi"
                description="Buka aplikasi authenticator Anda dan masukkan kode enam angka. Kode pemulihan juga bisa dipakai."
            >
                <form
                    noValidate
                    className="flex flex-col gap-6"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        verify.mutate({
                            body: {
                                code: String(form.get('code') ?? '').trim(),
                            },
                        });
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Belum berhasil login"
                    />
                    <div className="grid gap-6">
                        <div className="grid gap-2" data-error-field="code">
                            <Input
                                id="code"
                                label="Kode"
                                name="code"
                                required
                                autoFocus
                                autoComplete="one-time-code"
                                inputMode="text"
                            />
                        </div>
                        <Button
                            type="submit"
                            className="mt-4 w-full"
                            disabled={verify.isPending}
                        >
                            {verify.isPending && <Spinner />}
                            Lanjutkan
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                reset();
                                setStep('password');
                            }}
                        >
                            Kembali ke login
                        </Button>
                    </div>
                </form>
            </AuthCard>
        );

    return (
        <AuthCard
            key="password"
            title="Login ke konsol operator"
            description="Gunakan email dan password akun operator Anda."
        >
            <form
                noValidate
                className="flex flex-col gap-6"
                onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    login.mutate({
                        body: {
                            email: String(form.get('email') ?? ''),
                            password: String(form.get('password') ?? ''),
                        },
                    });
                }}
            >
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Belum berhasil login"
                />
                {/* Pesan per field ditempel ringkasan di atas ke field asalnya, jadi tidak ditulis kedua kalinya. */}
                <div className="grid gap-6">
                    <div className="grid gap-2" data-error-field="email">
                        <Input
                            id="email"
                            label="Email"
                            type="email"
                            name="email"
                            required
                            autoFocus
                            autoComplete="email"
                        />
                    </div>
                    <div className="grid gap-2" data-error-field="password">
                        <PasswordInput
                            id="password"
                            label="Password"
                            name="password"
                            required
                            autoComplete="current-password"
                        />
                    </div>
                    <Button
                        type="submit"
                        className="mt-4 w-full"
                        disabled={login.isPending}
                        data-test="login-button"
                    >
                        {login.isPending && <Spinner />}
                        Login
                    </Button>
                    {options.data?.sso && (
                        // Navigasi penuh: /sso/start dijawab server dengan pengalihan ke penyedia SSO.
                        <Button asChild variant="outline" className="w-full">
                            <a href="/sso/start">Login dengan SSO</a>
                        </Button>
                    )}
                </div>
            </form>
        </AuthCard>
    );
}

export const page = definePage({
    path: '/login',
    layout: 'auth',
    title: 'Login',
    validateSearch: z.object({
        redirect: z.string().optional(),
        sso_error: z.string().optional(),
        two_factor: z.literal(1).optional().catch(undefined),
    }),
    component: LoginPage,
});
