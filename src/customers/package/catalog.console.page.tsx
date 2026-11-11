import { ActionButton } from '@control-plane-metta/ui/action-button';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
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
import { Input } from '@control-plane-metta/ui/input';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { MultiSelect } from '@control-plane-metta/ui/multi-select';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { Textarea } from '@control-plane-metta/ui/textarea';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ApiError,
    definePage,
    errorText,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type Package = ApiOutput<'listPackages'>['packages'][number];
type CatalogModule = ApiOutput<'listModuleCatalog'>['modules'][number];

const editAction = { id: 'edit', label: 'Ubah' };
const deleteAction = { id: 'delete', label: 'Delete', destructive: true };

function PackageDialog({
    editing,
    modules,
    onOpenChange,
}: {
    editing: Package | null;
    modules: CatalogModule[];
    onOpenChange: (open: boolean) => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const content = useRef<HTMLDivElement>(null);
    const [name, setName] = useState(editing?.name ?? '');
    const [description, setDescription] = useState(editing?.description ?? '');
    const [moduleIds, setModuleIds] = useState(
        editing?.modules.map((module) => module.id) ?? [],
    );
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const callbacks = {
        onMutate: () => {
            setErrors({});
            setMessage(null);
        },
        onSuccess: async () => {
            toast.success('Susunan module disimpan.');
            onOpenChange(false);
            await queryClient.invalidateQueries({
                queryKey: orpc.listPackages.key(),
            });
        },
        onError: (caught: Error) => {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(errorText(caught, 'Susunan module belum disimpan.'));
        },
    };
    const create = useMutation(orpc.createPackage.mutationOptions(callbacks));
    const update = useMutation(orpc.updatePackage.mutationOptions(callbacks));
    const pending = create.isPending || update.isPending;
    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent size="compact" ref={content}>
                <form
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const body = {
                            name,
                            description: description || null,
                            module_ids: moduleIds,
                        };
                        if (editing)
                            update.mutate({
                                params: { package: editing.id },
                                body,
                            });
                        else create.mutate({ body });
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {editing
                                ? `Ubah ${editing.name}`
                                : 'Susunan module baru'}
                        </DialogTitle>
                        <DialogDescription>
                            Mengubah isinya tidak mengubah module customer yang
                            sudah diberi susunan ini.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody className="flex flex-col gap-4">
                        <FormControl error={errors.name?.[0]}>
                            <Input
                                label="Nama"
                                required
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                            />
                        </FormControl>
                        <FormControl error={errors.module_ids?.[0]}>
                            <MultiSelect
                                label="Module"
                                searchPlaceholder="Cari module…"
                                items={modules.map((module) => ({
                                    value: module.id,
                                    label: module.name,
                                }))}
                                value={moduleIds}
                                onValueChange={setModuleIds}
                                portalContainer={content}
                            />
                        </FormControl>
                        <FormControl error={errors.description?.[0]}>
                            <Textarea
                                label="Deskripsi"
                                value={description}
                                onChange={(event) =>
                                    setDescription(event.target.value)
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

function CatalogPage(): ReactNode {
    const queryClient = useQueryClient();
    const { confirm, confirmation } = useConfirmation();
    const [dialog, setDialog] = useState<{ editing: Package | null } | null>(
        null,
    );
    const { data: packages } = useSuspenseQuery(
        orpc.listPackages.queryOptions({
            select: (response) => response.packages,
        }),
    );
    const { data: modules } = useSuspenseQuery(
        orpc.listModuleCatalog.queryOptions({
            select: (response) => response.modules,
        }),
    );
    const remove = useMutation(
        orpc.deletePackage.mutationOptions({
            onSuccess: async () => {
                toast.success('Susunan module dihapus.');
                await queryClient.invalidateQueries({
                    queryKey: orpc.listPackages.key(),
                });
            },
            onError: (caught) =>
                toast.error(errorText(caught, 'Susunan module belum dihapus.')),
        }),
    );
    async function askDelete(pack: Package) {
        if (
            await confirm({
                title: `Hapus susunan ${pack.name}?`,
                description:
                    'Susunan ini tidak bisa dipilih lagi. Module customer yang pernah diberi susunan ini tetap ada.',
                confirmLabel: 'Delete',
                destructive: true,
            })
        )
            remove.mutate({ params: { package: pack.id } });
    }
    return (
        <ListPageLayout
            header={
                <RecordActionBar title="Katalog">
                    <ActionButton
                        action="create"
                        onClick={() => setDialog({ editing: null })}
                    />
                </RecordActionBar>
            }
        >
            <div className="flex flex-col gap-6">
                <DataTable
                    data={packages}
                    getRowKey={(pack) => pack.id}
                    getRowLabel={(pack) => pack.name}
                    emptyMessage="Belum ada susunan module. Buat susunan untuk memberi beberapa module sekaligus, misalnya per jenis faskes."
                    actions={[editAction, deleteAction]}
                    onRowAction={(action, pack) => {
                        if (action === editAction.id)
                            setDialog({ editing: pack });
                        else void askDelete(pack);
                    }}
                    columns={[
                        {
                            id: 'name',
                            header: 'Susunan module',
                            cell: (pack) => (
                                <DataTableText>{pack.name}</DataTableText>
                            ),
                            minWidth: 180,
                        },
                        {
                            id: 'modules',
                            header: 'Module',
                            cell: (pack) => (
                                <DataTableText>
                                    {pack.modules
                                        .map((module) => module.name)
                                        .join(', ')}
                                </DataTableText>
                            ),
                            minWidth: 260,
                        },
                        {
                            id: 'description',
                            header: 'Deskripsi',
                            cell: (pack) => (
                                <DataTableText>
                                    {pack.description ?? '-'}
                                </DataTableText>
                            ),
                            minWidth: 220,
                        },
                    ]}
                />
                <DataTable
                    data={modules}
                    getRowKey={(module) => module.id}
                    getRowLabel={(module) => module.name}
                    emptyMessage="Belum ada module. Module muncul setelah host runtime melaporkannya."
                    columns={[
                        {
                            id: 'name',
                            header: 'Module',
                            cell: (module) => (
                                <DataTableText>{module.name}</DataTableText>
                            ),
                            minWidth: 180,
                        },
                        {
                            id: 'description',
                            header: 'Deskripsi',
                            cell: (module) => (
                                <DataTableText>
                                    {module.description ?? '-'}
                                </DataTableText>
                            ),
                            minWidth: 260,
                        },
                        {
                            id: 'hosts',
                            header: 'Host yang membawanya',
                            cell: (module) => (
                                <DataTableText>
                                    {module.hosts.length
                                        ? module.hosts.join(', ')
                                        : 'Tidak ada host aktif'}
                                </DataTableText>
                            ),
                            minWidth: 200,
                        },
                    ]}
                />
            </div>
            {confirmation}
            {dialog && (
                <PackageDialog
                    editing={dialog.editing}
                    modules={modules}
                    onOpenChange={(open) => {
                        if (!open) setDialog(null);
                    }}
                />
            )}
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/catalog',
    layout: 'app',
    title: 'Katalog',
    component: CatalogPage,
});
