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
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    errorText,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type Access = ApiOutput<'listPortalAccess'>['access'][number];
type Sent = ApiOutput<'inviteToPortal'>;

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

// Email gagal terkirim: tautan tetap berlaku, jadi operator bisa mengirimkannya sendiri. Tautan hanya tampil di sini.
function SendFailureDialog({
    sent,
    onClose,
}: {
    sent: Sent;
    onClose: () => void;
}): ReactNode {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent size="compact">
                <DialogHeader>
                    <DialogTitle>Email undangan belum terkirim</DialogTitle>
                    <DialogDescription>
                        {sent.email_failure} Undangannya tetap tersimpan. Kirim
                        ulang nanti, atau kirim tautan ini sendiri lewat jalur
                        pribadi. Tautan ini tidak akan ditampilkan lagi.
                    </DialogDescription>
                </DialogHeader>
                <DialogBody className="flex flex-col gap-3">
                    <code className="rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all select-all">
                        {sent.accept_url}
                    </code>
                    <div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(
                                        sent.accept_url,
                                    );
                                    toast.success('Tautan disalin.');
                                } catch {
                                    toast.error(
                                        'Tautan belum tersalin. Pilih teksnya lalu salin manual.',
                                    );
                                }
                            }}
                        >
                            <Copy />
                            Salin tautan
                        </Button>
                    </div>
                </DialogBody>
                <DialogFooter>
                    <DialogAction type="button" onClick={onClose}>
                        Tutup
                    </DialogAction>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function InviteDialog({
    clientId,
    onClose,
    onSent,
}: {
    clientId: string;
    onClose: () => void;
    onSent: (sent: Sent) => void;
}): ReactNode {
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
            <DialogContent size="compact">
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        invite.mutate({
                            params: { client: clientId },
                            body: {
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
                            Penerima membukanya, lalu login SSO di portal.
                            Tautan berlaku 7 hari dan hanya bisa dipakai sekali.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        <FormGrid columns={1}>
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
}: {
    clientId: string;
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
                    'Akun SSO ini tidak bisa lagi masuk portal customer ini. Untuk memberi akses lagi, kirim undangan baru.',
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
                    onClose={() => setInviting(false)}
                    onSent={(result) => void sent(result)}
                />
            )}
            {failed && (
                <SendFailureDialog
                    sent={failed}
                    onClose={() => setFailed(null)}
                />
            )}
        </section>
    );
}
