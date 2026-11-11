import { Button } from '@control-plane-metta/ui/button';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import {
    DatePicker,
    dateValue,
    displayDate,
} from '@control-plane-metta/ui/date-picker';
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
import { FormControl } from '@control-plane-metta/ui/form-control';
import { Select } from '@control-plane-metta/ui/select';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    errorText,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type Tenant = ApiOutput<'showCustomer'>['customer']['tenants'][number];
type Entitlement = Tenant['entitlements'][number];

const changeAction = { id: 'change', label: 'Ubah tanggal berakhir' };
const revokeAction = { id: 'revoke', label: 'Cabut', destructive: true };
const applyingNote =
    'Lingkungan tenant ini menyesuaikan saat worker mengambil pekerjaan berikutnya.';

// Pilihan di dialog tambah module: satu module, atau satu susunan module dari Katalog yang memberi semua module-nya
// sekaligus.
type Choice = { kind: 'module' | 'group'; id: string };
const encode = (choice: Choice) => `${choice.kind}:${choice.id}`;
function decode(value: string): Choice | null {
    const [kind, id] = value.split(':', 2);
    if ((kind === 'module' || kind === 'group') && id) return { kind, id };
    return null;
}

function useRefreshCustomer() {
    const queryClient = useQueryClient();
    return () =>
        queryClient.invalidateQueries({ queryKey: orpc.showCustomer.key() });
}

// Satu dialog untuk memberi hak baru (module atau susunan module dipilih) dan mengubah tanggal berakhir hak yang ada.
function EntitlementDialog({
    tenant,
    editing,
    onOpenChange,
}: {
    tenant: Tenant;
    editing: Entitlement | null;
    onOpenChange: (open: boolean) => void;
}): ReactNode {
    const refresh = useRefreshCustomer();
    const content = useRef<HTMLDivElement>(null);
    const [choice, setChoice] = useState('');
    const [endsOn, setEndsOn] = useState(editing?.ends_on ?? '');
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const catalog = useQuery({
        ...orpc.listModuleCatalog.queryOptions(),
        enabled: editing === null,
    });
    const groups = useQuery({
        ...orpc.listPackages.queryOptions(),
        enabled: editing === null,
    });
    const entitled = new Set(tenant.entitlements.map((row) => row.module_id));
    const items = [
        ...(catalog.data?.modules ?? [])
            .filter((module) => !entitled.has(module.id))
            .map((module) => ({
                value: encode({ kind: 'module', id: module.id }),
                label: module.name,
            })),
        ...(groups.data?.packages ?? []).map((group) => ({
            value: encode({ kind: 'group', id: group.id }),
            label: `${group.name}: ${group.modules.map((module) => module.name).join(', ')}`,
        })),
    ];
    const done = async (text: string) => {
        toast.success(text);
        onOpenChange(false);
        await refresh();
    };
    const failed = (caught: Error) => {
        if (caught instanceof ApiError && caught.status === 422)
            setErrors(caught.errors);
        else setMessage(errorText(caught, 'Module belum disimpan.'));
    };
    const reset = () => {
        setErrors({});
        setMessage(null);
    };
    const grant = useMutation(
        orpc.grantEntitlement.mutationOptions({
            onMutate: reset,
            onSuccess: () => done(`Module ditambahkan. ${applyingNote}`),
            onError: failed,
        }),
    );
    const grantGroup = useMutation(
        orpc.grantPackage.mutationOptions({
            onMutate: reset,
            onSuccess: (result) =>
                done(
                    result.granted.length
                        ? `${String(result.granted.length)} module ditambahkan. ${applyingNote}`
                        : 'Tenant ini sudah memiliki semua module di susunan itu.',
                ),
            onError: failed,
        }),
    );
    const change = useMutation(
        orpc.changeEntitlement.mutationOptions({
            onMutate: reset,
            onSuccess: () => done(`Tanggal berakhir disimpan. ${applyingNote}`),
            onError: failed,
        }),
    );
    const pending = grant.isPending || grantGroup.isPending || change.isPending;
    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent size="compact" ref={content}>
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const ends_on = endsOn === '' ? null : endsOn;
                        if (editing) {
                            change.mutate({
                                params: { entitlement: editing.id },
                                body: { ends_on },
                            });
                            return;
                        }
                        const chosen = decode(choice);
                        if (!chosen) {
                            setErrors({ module_id: ['Pilih module.'] });
                            return;
                        }
                        if (chosen.kind === 'module')
                            grant.mutate({
                                params: { tenant: tenant.id },
                                body: { module_id: chosen.id, ends_on },
                            });
                        else
                            grantGroup.mutate({
                                params: { tenant: tenant.id },
                                body: { package_id: chosen.id, ends_on },
                            });
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {editing
                                ? `Ubah ${editing.module_name}`
                                : 'Tambah module'}
                        </DialogTitle>
                        <DialogDescription>
                            Berlaku untuk semua lingkungan {tenant.slug}. Data
                            yang sudah dibuat tidak terhapus saat hak berakhir
                            atau dicabut.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody className="flex flex-col gap-4">
                        {!editing && (
                            <FormControl
                                error={
                                    errors.module_id?.[0] ??
                                    errors.package_id?.[0]
                                }
                                hint={
                                    catalog.data && !catalog.data.modules.length
                                        ? 'Belum ada module. Module muncul setelah host runtime melaporkannya.'
                                        : 'Susunan module memberi semua module di dalamnya sekaligus. Module yang sudah dimiliki tidak diubah.'
                                }
                            >
                                <Select
                                    label="Module"
                                    required
                                    searchPlaceholder="Cari module…"
                                    items={items}
                                    value={choice}
                                    onValueChange={(value) =>
                                        setChoice(value ?? '')
                                    }
                                    portalContainer={content}
                                />
                            </FormControl>
                        )}
                        <FormControl
                            error={errors.ends_on?.[0]}
                            hint="Hari terakhir module boleh dipakai. Kosongkan untuk tanpa batas."
                        >
                            <DatePicker
                                label="Berakhir"
                                min={dateValue(new Date())}
                                value={endsOn}
                                onValueChange={setEndsOn}
                                portalContainer={content}
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
                    </DialogBody>
                    <DialogFooter>
                        <DialogAction type="submit" disabled={pending}>
                            {pending ? 'Menyimpan…' : 'Simpan'}
                        </DialogAction>
                        <DialogCancel />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function ModuleEntitlements({ tenant }: { tenant: Tenant }): ReactNode {
    const refresh = useRefreshCustomer();
    const { confirm, confirmation } = useConfirmation();
    const [dialog, setDialog] = useState<{
        editing: Entitlement | null;
    } | null>(null);
    const revoke = useMutation(
        orpc.revokeEntitlement.mutationOptions({
            onSuccess: async () => {
                toast.success('Hak module dicabut.');
                await refresh();
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Hak module belum dicabut.')),
        }),
    );
    async function askRevoke(entitlement: Entitlement) {
        if (
            await confirm({
                title: `Cabut ${entitlement.module_name}?`,
                description:
                    'Menu module ini hilang dari semua lingkungan tenant. Data yang sudah dibuat tetap tersimpan dan terlihat lagi bila haknya diberikan kembali.',
                confirmLabel: 'Cabut',
                destructive: true,
            })
        )
            revoke.mutate({ params: { entitlement: entitlement.id } });
    }
    return (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Module</h2>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setDialog({ editing: null })}
                >
                    Tambah module
                </Button>
            </div>
            <DataTable
                data={tenant.entitlements}
                getRowKey={(entitlement) => entitlement.id}
                scrollMode="inline"
                emptyMessage="Tenant ini belum berhak memakai module apa pun."
                actions={[changeAction, revokeAction]}
                onRowAction={(action, entitlement) => {
                    if (action === changeAction.id)
                        setDialog({ editing: entitlement });
                    else void askRevoke(entitlement);
                }}
                columns={[
                    {
                        id: 'module',
                        header: 'Module',
                        cell: (entitlement) => (
                            <DataTableText>
                                {entitlement.module_name}
                            </DataTableText>
                        ),
                        minWidth: 200,
                    },
                    {
                        id: 'ends_on',
                        header: 'Berakhir',
                        cell: (entitlement) => (
                            <DataTableText>
                                {entitlement.ends_on
                                    ? displayDate(entitlement.ends_on)
                                    : 'Tanpa batas'}
                            </DataTableText>
                        ),
                        minWidth: 140,
                    },
                ]}
            />
            {confirmation}
            {dialog && (
                <EntitlementDialog
                    tenant={tenant}
                    editing={dialog.editing}
                    onOpenChange={(open) => {
                        if (!open) setDialog(null);
                    }}
                />
            )}
        </section>
    );
}
