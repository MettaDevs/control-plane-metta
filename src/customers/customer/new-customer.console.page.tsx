import { ActionButton } from '@control-plane-metta/ui/action-button';
import {
    Alert,
    AlertDescription,
    AlertTitle,
} from '@control-plane-metta/ui/alert';
import { Button } from '@control-plane-metta/ui/button';
import { DatePicker, dateValue } from '@control-plane-metta/ui/date-picker';
import { FormControl, FormGrid } from '@control-plane-metta/ui/form-control';
import { Input } from '@control-plane-metta/ui/input';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { Select } from '@control-plane-metta/ui/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Copy, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type Created = ApiOutput<'createCustomer'>;
type Kind = 'production' | 'demo';

const formId = 'new-customer';

function tomorrow(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return dateValue(date);
}

// Password sementara tampil sekali di sini. Server tidak menyimpannya dan tidak akan mengirimnya lagi.
function CreatedPanel({ created }: { created: Created }): ReactNode {
    const password = created.temporary_password;
    return (
        <div className="flex max-w-2xl flex-col gap-4 p-6">
            {password ? (
                <>
                    <Alert>
                        <TriangleAlert />
                        <AlertTitle>
                            Simpan password ini sekarang. Password ini tidak
                            akan ditampilkan lagi.
                        </AlertTitle>
                        <AlertDescription>
                            Berikan kepada admin pertama ({created.admin_email})
                            lewat jalur yang aman. Admin memakainya untuk login
                            pertama setelah lingkungannya selesai disiapkan.
                        </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap items-center gap-2">
                        <code
                            className="rounded-md border bg-muted px-3 py-2 font-mono text-sm select-all"
                            data-test="temporary-password"
                        >
                            {password}
                        </code>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(
                                        password,
                                    );
                                    toast.success('Password disalin.');
                                } catch {
                                    toast.error(
                                        'Password belum tersalin. Pilih teksnya lalu salin manual.',
                                    );
                                }
                            }}
                        >
                            <Copy />
                            Salin password
                        </Button>
                    </div>
                </>
            ) : (
                <Alert>
                    <AlertTitle>
                        Customer ini sudah dibuat pada percobaan sebelumnya.
                    </AlertTitle>
                    <AlertDescription>
                        Password sementara hanya tampil pada jawaban pertama,
                        jadi tidak dapat ditampilkan lagi.
                    </AlertDescription>
                </Alert>
            )}
            <p className="text-sm text-muted-foreground">
                Lingkungan pertamanya sedang menunggu disiapkan. Statusnya
                terlihat di daftar customer.
            </p>
            <div>
                <Button asChild>
                    <Link to="/customers">Ke daftar customer</Link>
                </Button>
            </div>
        </div>
    );
}

function NewCustomerPage(): ReactNode {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    // Satu kunci untuk satu isian form. Mengirim ulang setelah jawaban hilang memakai kunci yang sama, jadi server
    // mengembalikan customer yang sudah dibuat, bukan membuat customer kedua.
    const [idempotencyKey] = useState(() => crypto.randomUUID());
    const [legalName, setLegalName] = useState('');
    const [slug, setSlug] = useState('');
    const [adminName, setAdminName] = useState('');
    const [adminEmail, setAdminEmail] = useState('');
    const [kind, setKind] = useState<Kind>('production');
    const [expiresAt, setExpiresAt] = useState('');
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [created, setCreated] = useState<Created | null>(null);

    const create = useMutation(
        orpc.createCustomer.mutationOptions({
            onMutate: () => {
                setErrors({});
                setMessage(null);
            },
            onSuccess: async (response) => {
                setCreated(response);
                await queryClient.invalidateQueries({
                    queryKey: orpc.listCustomers.key(),
                });
            },
            onError: (caught) => {
                if (!(caught instanceof ApiError) || caught.status !== 422) {
                    setMessage(errorText(caught, 'Customer belum dibuat.'));
                    return;
                }
                switch (caught.errorCode) {
                    case 'slug_taken':
                        setErrors({
                            slug: [
                                'Slug ini sudah pernah dipakai dan tidak bisa dipakai ulang. Pilih slug lain.',
                            ],
                        });
                        return;
                    case 'idempotency_key_reused':
                        setMessage(
                            'Percobaan sebelumnya dari form ini sudah membuat customer dengan isian yang berbeda. Periksa daftar customer sebelum membuat lagi.',
                        );
                        return;
                    default:
                        setErrors(caught.errors);
                        if (!Object.keys(caught.errors).length)
                            setMessage(
                                errorText(caught, 'Customer belum dibuat.'),
                            );
                }
            },
        }),
    );

    if (created)
        return (
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                <RecordActionBar title={`Customer dibuat: ${legalName}`} />
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <CreatedPanel created={created} />
                </div>
            </div>
        );

    const busy = create.isPending;
    const error = (field: string) => errors[field]?.[0];

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar title="Customer baru">
                <ActionButton
                    action="save"
                    type="submit"
                    form={formId}
                    disabled={busy}
                    pending={busy}
                />
                <ActionButton
                    action="cancel"
                    disabled={busy}
                    onClick={() => void navigate({ to: '/customers' })}
                />
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <form
                    noValidate
                    id={formId}
                    className="max-w-2xl"
                    onSubmit={(event) => {
                        event.preventDefault();
                        create.mutate({
                            headers: { 'idempotency-key': idempotencyKey },
                            body: {
                                legal_name: legalName,
                                slug,
                                admin: { name: adminName, email: adminEmail },
                                environment:
                                    kind === 'demo'
                                        ? { kind, expires_at: expiresAt }
                                        : { kind },
                            },
                        });
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Customer belum dibuat"
                    />
                    <FormGrid>
                        <FormControl error={error('legal_name')}>
                            <Input
                                label="Nama badan usaha"
                                required
                                autoFocus
                                maxLength={255}
                                data-error-field="legal_name"
                                value={legalName}
                                onChange={(event) =>
                                    setLegalName(event.target.value)
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={error('slug')}
                            hint="Slug menjadi bagian depan alamat klinik. Isinya huruf kecil, angka, dan tanda hubung. Slug tidak pernah dipakai ulang, juga setelah customer-nya dihapus, jadi pilih dengan hati-hati."
                        >
                            <Input
                                label="Slug"
                                required
                                maxLength={63}
                                autoCapitalize="none"
                                spellCheck={false}
                                data-error-field="slug"
                                value={slug}
                                onChange={(event) =>
                                    setSlug(event.target.value.toLowerCase())
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={error('admin.name')}
                            hint="Admin pertama klinik. Ia login dengan password sementara yang tampil sekali setelah customer dibuat."
                        >
                            <Input
                                label="Nama admin"
                                required
                                maxLength={255}
                                data-error-field="admin.name"
                                value={adminName}
                                onChange={(event) =>
                                    setAdminName(event.target.value)
                                }
                            />
                        </FormControl>
                        <FormControl error={error('admin.email')}>
                            <Input
                                label="Email admin"
                                type="email"
                                required
                                maxLength={255}
                                data-error-field="admin.email"
                                value={adminEmail}
                                onChange={(event) =>
                                    setAdminEmail(event.target.value)
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={
                                error('environment.kind') ??
                                error('environment')
                            }
                            hint="Produksi untuk klinik yang sudah memakai sistem sungguhan. Demo untuk percobaan dan berhenti pada tanggal berakhir."
                        >
                            <div data-error-field="environment">
                                <Select
                                    label="Lingkungan pertama"
                                    required
                                    searchPlaceholder="Cari…"
                                    items={[
                                        {
                                            value: 'production',
                                            label: 'Produksi',
                                        },
                                        { value: 'demo', label: 'Demo' },
                                    ]}
                                    value={kind}
                                    onValueChange={(value) =>
                                        setKind(
                                            value === 'demo'
                                                ? 'demo'
                                                : 'production',
                                        )
                                    }
                                />
                            </div>
                        </FormControl>
                        {kind === 'demo' && (
                            <FormControl
                                error={error('environment.expires_at')}
                            >
                                <DatePicker
                                    label="Demo berakhir"
                                    required
                                    min={tomorrow()}
                                    data-error-field="environment.expires_at"
                                    value={expiresAt}
                                    onValueChange={setExpiresAt}
                                />
                            </FormControl>
                        )}
                    </FormGrid>
                </form>
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/customers/new',
    layout: 'app',
    title: 'Customer baru',
    component: NewCustomerPage,
});
