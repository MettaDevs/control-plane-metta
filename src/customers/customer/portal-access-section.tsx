import { Badge } from '@control-plane-metta/ui/badge';
import { Button } from '@control-plane-metta/ui/button';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { displayDate } from '@control-plane-metta/ui/date-picker';
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
import { Input } from '@control-plane-metta/ui/input';
import { Select } from '@control-plane-metta/ui/select';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    errorText,
    InvitationLinkDialog,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type Access = ApiOutput<'listPortalAccess'>['access'][number];
type Sent = ApiOutput<'inviteToPortal'>;
type Tenant = { id: string; name: string };

const resendAction = { id: 'resend', label: 'Kirim ulang undangan' };
const cancelAction = {
    id: 'cancel',
    label: 'Batalkan undangan',
    destructive: true,
};
const revokeAction = { id: 'revoke', label: 'Cabut akses', destructive: true };

function statusOf(row: Access): {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
    if (row.kind === 'user') return { label: 'Aktif', variant: 'default' };
    if (row.expired)
        return { label: 'Undangan kedaluwarsa', variant: 'outline' };
    if (!row.notified)
        return { label: 'Email belum terkirim', variant: 'destructive' };
    return { label: 'Undangan terkirim', variant: 'secondary' };
}

function InviteDialog({
    clientId,
    tenants,
    onClose,
    onSent,
}: {
    clientId: string;
    tenants: Tenant[];
    onClose: () => void;
    onSent: (sent: Sent) => void;
}): ReactNode {
    const content = useRef<HTMLDivElement>(null);
    // Customer dengan satu klinik langsung memilih klinik itu.
    const [tenantId, setTenantId] = useState(
        tenants.length === 1 ? tenants[0]!.id : '',
    );
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const invite = useMutation(
        orpc.inviteToPortal.mutationOptions({
            onMutate: () => {
                setErrors({});
                setMessage(null);
            },
            onSuccess: onSent,
            onError: (caught) => {
                if (caught instanceof ApiError && caught.status === 422)
                    setErrors(caught.errors);
                else setMessage(errorText(caught, 'Undangan belum dibuat.'));
            },
        }),
    );
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent size="compact" ref={content}>
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        invite.mutate({
                            params: { client: clientId },
                            body: {
                                tenant_id: tenantId,
                                recipient_email: email,
                                recipient_name: name || null,
                            },
                        });
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Undang ke portal</DialogTitle>
                        <DialogDescription>
                            Penyedia SSO mengirim email berisi tautan undangan.
                            Penerima membukanya, lalu login SSO di portal dan
                            mendapat akun di klinik tanpa role. Tautan berlaku 7
                            hari dan hanya bisa dipakai sekali.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        <FormGrid columns={1}>
                            <FormControl error={errors.tenant_id?.[0]}>
                                <Select
                                    label="Klinik"
                                    required
                                    items={tenants.map((tenant) => ({
                                        value: tenant.id,
                                        label: tenant.name,
                                    }))}
                                    value={tenantId}
                                    onValueChange={(value) =>
                                        setTenantId(value ?? '')
                                    }
                                    portalContainer={content}
                                />
                            </FormControl>
                            <FormControl error={errors.recipient_email?.[0]}>
                                <Input
                                    label="Email"
                                    type="email"
                                    required
                                    autoFocus
                                    maxLength={255}
                                    value={email}
                                    onChange={(event) =>
                                        setEmail(event.target.value)
                                    }
                                />
                            </FormControl>
                            <FormControl error={errors.recipient_name?.[0]}>
                                <Input
                                    label="Nama"
                                    maxLength={255}
                                    value={name}
                                    onChange={(event) =>
                                        setName(event.target.value)
                                    }
                                />
                            </FormControl>
                            {message && (
                                <p
                                    role="alert"
                                    className="text-sm text-destructive"
                                >
                                    {message}
                                </p>
                            )}
                        </FormGrid>
                    </DialogBody>
                    <DialogFooter>
                        <DialogAction type="submit" disabled={invite.isPending}>
                            {invite.isPending ? 'Mengirim…' : 'Kirim undangan'}
                        </DialogAction>
                        <DialogCancel />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// Siapa dari pihak customer yang boleh masuk portal klien, dan undangan yang masih menunggu.
export function PortalAccessSection({
    clientId,
    tenants,
}: {
    clientId: string;
    tenants: Tenant[];
}): ReactNode {
    const queryClient = useQueryClient();
    const { confirm, confirmation } = useConfirmation();
    const [inviting, setInviting] = useState(false);
    const [failed, setFailed] = useState<Sent | null>(null);
    const access = useQuery(
        orpc.listPortalAccess.queryOptions({
            input: { params: { client: clientId } },
        }),
    );
    const refresh = () =>
        queryClient.invalidateQueries({
            queryKey: orpc.listPortalAccess.key(),
        });
    const sent = async (result: Sent) => {
        setInviting(false);
        if (result.email_failure) setFailed(result);
        else toast.success('Undangan dikirim ke email penerima.');
        await refresh();
    };
    const resend = useMutation(
        orpc.resendPortalInvitation.mutationOptions({
            onSuccess: sent,
            onError: (caught) =>
                toast.error(errorText(caught, 'Undangan belum dikirim ulang.')),
        }),
    );
    const cancel = useMutation(
        orpc.cancelPortalInvitation.mutationOptions({
            onSuccess: async () => {
                toast.success('Undangan dibatalkan.');
                await refresh();
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Undangan belum dibatalkan.')),
        }),
    );
    const revoke = useMutation(
        orpc.revokePortalUser.mutationOptions({
            onSuccess: async () => {
                toast.success('Akses portal dicabut.');
                await refresh();
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Akses portal belum dicabut.')),
        }),
    );
    async function act(action: string, row: Access) {
        const who = row.name ?? row.email ?? 'akun ini';
        if (action === resendAction.id) {
            resend.mutate({ params: { invitation: row.id } });
            return;
        }
        if (action === cancelAction.id) {
            if (
                await confirm({
                    title: `Batalkan undangan untuk ${who}?`,
                    description:
                        'Tautan di email undangan tidak bisa dipakai lagi.',
                    confirmLabel: 'Batalkan undangan',
                    destructive: true,
                })
            )
                cancel.mutate({ params: { invitation: row.id } });
            return;
        }
        if (
            await confirm({
                title: `Cabut akses portal ${who}?`,
                description:
                    'Akun SSO ini tidak bisa lagi masuk portal klinik ini. Akunnya di dalam klinik tidak ikut dicabut; atur dari klinik itu sendiri. Untuk memberi akses portal lagi, kirim undangan baru.',
                confirmLabel: 'Cabut akses',
                destructive: true,
            })
        )
            revoke.mutate({ params: { user: row.id } });
    }
    const configured = access.data?.configured ?? true;
    return (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Akses portal</h2>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={!configured}
                    title={
                        configured
                            ? undefined
                            : 'Portal klien belum disetel di server ini.'
                    }
                    onClick={() => setInviting(true)}
                >
                    Undang
                </Button>
            </div>
            <DataTable
                data={access.data?.access ?? []}
                getRowKey={(row) => row.id}
                scrollMode="inline"
                emptyMessage={
                    access.isError
                        ? errorText(
                              access.error,
                              'Akses portal belum bisa dimuat.',
                          )
                        : access.isPending
                          ? 'Memuat akses portal…'
                          : 'Belum ada yang bisa masuk portal klien. Pilih Undang untuk mengirim undangan lewat email.'
                }
                actions={[resendAction, cancelAction, revokeAction]}
                getRowActions={(row) =>
                    row.kind === 'user'
                        ? [revokeAction]
                        : [resendAction, cancelAction]
                }
                onRowAction={(action, row) => void act(action, row)}
                columns={[
                    {
                        id: 'name',
                        header: 'Nama',
                        cell: (row) => (
                            <DataTableText>{row.name ?? '-'}</DataTableText>
                        ),
                        minWidth: 160,
                    },
                    {
                        id: 'email',
                        header: 'Email',
                        cell: (row) => (
                            <DataTableText>{row.email ?? '-'}</DataTableText>
                        ),
                        minWidth: 200,
                    },
                    {
                        id: 'tenant',
                        header: 'Klinik',
                        cell: (row) => (
                            <DataTableText>{row.tenant_name}</DataTableText>
                        ),
                        minWidth: 160,
                    },
                    {
                        id: 'role',
                        header: 'Peran',
                        cell: (row) => (
                            <DataTableText>
                                {row.admin ? 'Admin' : 'Anggota'}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        cell: (row) => {
                            const status = statusOf(row);
                            return (
                                <Badge variant={status.variant}>
                                    {status.label}
                                </Badge>
                            );
                        },
                        minWidth: 170,
                    },
                    {
                        id: 'expires_at',
                        header: 'Undangan berlaku sampai',
                        cell: (row) => (
                            <DataTableText>
                                {row.expires_at
                                    ? displayDate(row.expires_at.slice(0, 10))
                                    : '-'}
                            </DataTableText>
                        ),
                        minWidth: 160,
                    },
                ]}
            />
            {confirmation}
            {inviting && (
                <InviteDialog
                    clientId={clientId}
                    tenants={tenants}
                    onClose={() => setInviting(false)}
                    onSent={(result) => void sent(result)}
                />
            )}
            {failed && (
                <InvitationLinkDialog
                    sent={failed}
                    onClose={() => setFailed(null)}
                />
            )}
        </section>
    );
}
