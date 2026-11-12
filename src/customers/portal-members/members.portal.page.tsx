import { ActionButton } from '@control-plane-metta/ui/action-button';
import { Badge } from '@control-plane-metta/ui/badge';
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
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    definePage,
    errorText,
    InvitationLinkDialog,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.portal.ts';

type Row = ApiOutput<'listMembers'>['members'][number];
type Sent = ApiOutput<'inviteMember'>;

const resendAction = { id: 'resend', label: 'Kirim ulang' };
const cancelAction = {
    id: 'cancel',
    label: 'Batalkan undangan',
    destructive: true,
};

function statusOf(row: Row): {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
    if (row.kind === 'user') return { label: 'Aktif', variant: 'default' };
    if (row.expired) return { label: 'Kedaluwarsa', variant: 'outline' };
    if (!row.notified)
        return { label: 'Email belum terkirim', variant: 'destructive' };
    return { label: 'Undangan terkirim', variant: 'secondary' };
}

function InviteDialog({
    onClose,
    onSent,
}: {
    onClose: () => void;
    onSent: (sent: Sent) => void;
}): ReactNode {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const invite = useMutation(
        orpc.inviteMember.mutationOptions({
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
                            body: {
                                recipient_email: email,
                                recipient_name: name || null,
                            },
                        });
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Undang anggota</DialogTitle>
                        <DialogDescription>
                            Kami mengirim email berisi tautan undangan. Penerima
                            membukanya lalu masuk dengan akun SSO, dan mendapat
                            akun di klinik ini tanpa hak akses apa pun. Atur hak
                            aksesnya dari dalam klinik. Tautan berlaku 7 hari
                            dan hanya bisa dipakai sekali.
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

// Anggota klinik aktif yang bisa masuk portal, dan undangan yang belum dipakai, dalam satu daftar. Hanya admin klinik
// yang mengundang, mengirim ulang, dan membatalkan.
function MembersPage(): ReactNode {
    const queryClient = useQueryClient();
    const { confirm, confirmation } = useConfirmation();
    const [inviting, setInviting] = useState(false);
    const [failed, setFailed] = useState<Sent | null>(null);
    const { data } = useSuspenseQuery(orpc.listMembers.queryOptions());
    const refresh = () =>
        queryClient.invalidateQueries({ queryKey: orpc.listMembers.key() });
    const sent = async (result: Sent) => {
        setInviting(false);
        if (result.email_failure) setFailed(result);
        else toast.success('Undangan dikirim ke email penerima.');
        await refresh();
    };
    const resend = useMutation(
        orpc.resendMemberInvitation.mutationOptions({
            onSuccess: sent,
            onError: (caught) =>
                toast.error(errorText(caught, 'Undangan belum dikirim ulang.')),
        }),
    );
    const cancel = useMutation(
        orpc.cancelMemberInvitation.mutationOptions({
            onSuccess: async () => {
                toast.success('Undangan dibatalkan.');
                await refresh();
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Undangan belum dibatalkan.')),
        }),
    );
    async function act(action: string, row: Row) {
        if (action === resendAction.id) {
            resend.mutate({ params: { invitation: row.id } });
            return;
        }
        if (
            await confirm({
                title: `Batalkan undangan untuk ${row.name ?? row.email ?? 'penerima ini'}?`,
                description:
                    'Tautan di email undangan tidak bisa dipakai lagi.',
                confirmLabel: 'Batalkan undangan',
                destructive: true,
            })
        )
            cancel.mutate({ params: { invitation: row.id } });
    }

    return (
        <ListPageLayout
            header={
                <RecordActionBar title="Anggota">
                    <ActionButton
                        action="create"
                        disabled={!data.can_invite}
                        title={
                            data.can_invite
                                ? undefined
                                : 'Hanya admin klinik ini yang bisa mengundang anggota.'
                        }
                        onClick={() => setInviting(true)}
                    />
                </RecordActionBar>
            }
        >
            <DataTable
                data={data.members}
                getRowKey={(row) => row.id}
                getRowLabel={(row) => row.name ?? row.email ?? '-'}
                emptyMessage="Belum ada anggota."
                actions={[resendAction, cancelAction]}
                getRowActions={(row) =>
                    data.can_invite && row.kind === 'invitation'
                        ? [resendAction, cancelAction]
                        : []
                }
                onRowAction={(action, row) => void act(action, row)}
                columns={[
                    {
                        id: 'name',
                        header: 'Nama',
                        cell: (row) => (
                            <DataTableText>{row.name ?? '-'}</DataTableText>
                        ),
                        sortValue: (row) => row.name ?? '',
                        minWidth: 180,
                    },
                    {
                        id: 'email',
                        header: 'Email',
                        cell: (row) => (
                            <DataTableText>{row.email ?? '-'}</DataTableText>
                        ),
                        sortValue: (row) => row.email ?? '',
                        minWidth: 220,
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
                        id: 'role',
                        header: 'Peran',
                        cell: (row) => (
                            <DataTableText>
                                {row.admin ? 'Admin' : 'Anggota'}
                            </DataTableText>
                        ),
                        minWidth: 100,
                    },
                    {
                        id: 'since',
                        header: 'Sejak',
                        cell: (row) => (
                            <DataTableText>
                                {displayDate(row.since.slice(0, 10))}
                            </DataTableText>
                        ),
                        sortValue: (row) => row.since,
                        minWidth: 120,
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
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/members',
    layout: 'app',
    title: 'Anggota',
    component: MembersPage,
});
