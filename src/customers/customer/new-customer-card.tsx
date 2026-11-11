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
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@control-plane-metta/ui/page-dialog';
import { Select } from '@control-plane-metta/ui/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type Created = ApiOutput<'createCustomer'>;
type Kind = 'production' | 'demo';

// Pilihan host runtime yang menyerahkan penempatan ke control plane.
const automatic = 'auto';

function tomorrow(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return dateValue(date);
}

// Password sementara tampil sekali di sini. Server tidak menyimpannya dan tidak akan mengirimnya lagi.
function CreatedPanel({
    created,
    onClose,
}: {
    created: Created;
    onClose: () => void;
}): ReactNode {
    const password = created.temporary_password;
    return (
        <div className="flex max-w-2xl flex-col gap-4">
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
                <Button type="button" onClick={onClose}>
                    Tutup
                </Button>
            </div>
        </div>
    );
}

// Kartu customer baru, dibuka dari tombol Baru di daftar customer supaya daftarnya tetap terlihat di belakang.
export function NewCustomerCard({
    onClose,
}: {
    onClose: () => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const contentRef = useRef<HTMLDivElement>(null);
    // Satu kunci untuk satu isian form. Mengirim ulang setelah jawaban hilang memakai kunci yang sama, jadi server
    // mengembalikan customer yang sudah dibuat, bukan membuat customer kedua.
    const [idempotencyKey] = useState(() => crypto.randomUUID());
    const [legalName, setLegalName] = useState('');
    const [slug, setSlug] = useState('');
    const [adminName, setAdminName] = useState('');
    const [adminEmail, setAdminEmail] = useState('');
    const [kind, setKind] = useState<Kind>('production');
    // Kosong berarti control plane memilih host aktif dengan lingkungan paling sedikit.
    const [runtimeHostId, setRuntimeHostId] = useState<string | null>(null);
    const hosts = useQuery(
        orpc.listRuntimeHosts.queryOptions({
            select: (response) =>
                // Pilihan langsung boleh host khusus, tetapi tidak host yang tidak tersedia.
                response.runtime_hosts.filter(
                    (host) => host.availability === 'available',
                ),
        }),
    );
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

    const busy = create.isPending;
    const error = (field: string) => errors[field]?.[0];

    return (
        <PageDialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <PageDialogContent
                ref={contentRef}
                title={
                    created ? `Customer dibuat: ${legalName}` : 'Customer baru'
                }
                editing={!created}
                busy={busy}
                onEscapeKeyDown={(event) => {
                    if (
                        busy ||
                        contentRef.current?.querySelector(
                            '[role="combobox"][aria-expanded="true"]',
                        )
                    )
                        event.preventDefault();
                }}
            >
                {created ? (
                    <PageDialogBody className="py-3">
                        <CreatedPanel created={created} onClose={onClose} />
                    </PageDialogBody>
                ) : (
                    <form
                        noValidate
                        className="flex min-h-0 flex-1 flex-col"
                        onSubmit={(event) => {
                            event.preventDefault();
                            create.mutate({
                                headers: { 'idempotency-key': idempotencyKey },
                                body: {
                                    legal_name: legalName,
                                    slug,
                                    admin: {
                                        name: adminName,
                                        email: adminEmail,
                                    },
                                    environment:
                                        kind === 'demo'
                                            ? { kind, expires_at: expiresAt }
                                            : { kind },
                                    ...(runtimeHostId
                                        ? { runtime_host_id: runtimeHostId }
                                        : {}),
                                },
                            });
                        }}
                    >
                        <PageDialogToolbar>
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy}
                            />
                            <ActionButton
                                action="cancel"
                                disabled={busy}
                                onClick={onClose}
                            />
                        </PageDialogToolbar>
                        <FormErrorHeader
                            errors={errors}
                            message={message}
                            operation="Customer belum dibuat"
                        />
                        <PageDialogBody className="py-3">
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
                                            setSlug(
                                                event.target.value.toLowerCase(),
                                            )
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
                                                {
                                                    value: 'demo',
                                                    label: 'Demo',
                                                },
                                            ]}
                                            value={kind}
                                            portalContainer={contentRef}
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
                                <FormControl
                                    error={error('runtime_host_id')}
                                    hint="Server tempat database klinik ini dibuat. Biarkan Otomatis supaya dipilih server aktif yang paling sedikit isinya."
                                >
                                    <div data-error-field="runtime_host_id">
                                        <Select
                                            label="Host runtime"
                                            searchPlaceholder="Cari…"
                                            items={[
                                                {
                                                    value: automatic,
                                                    label: 'Otomatis',
                                                },
                                                ...(hosts.data ?? []).map(
                                                    (host) => ({
                                                        value: host.id,
                                                        label: `${host.name} (${String(host.environments)} lingkungan${host.dedicated ? ', khusus' : ''})`,
                                                    }),
                                                ),
                                            ]}
                                            value={runtimeHostId ?? automatic}
                                            portalContainer={contentRef}
                                            onValueChange={(value) =>
                                                setRuntimeHostId(
                                                    value && value !== automatic
                                                        ? value
                                                        : null,
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
                                            portalContainer={contentRef}
                                        />
                                    </FormControl>
                                )}
                            </FormGrid>
                        </PageDialogBody>
                    </form>
                )}
            </PageDialogContent>
        </PageDialog>
    );
}
