import { ActionButton } from '@control-plane-metta/ui/action-button';
import { DataTable, DataTableText } from '@control-plane-metta/ui/data-table';
import { FormControl, FormGrid } from '@control-plane-metta/ui/form-control';
import { Input } from '@control-plane-metta/ui/input';
import { ListPageLayout } from '@control-plane-metta/ui/list-page-layout';
import { MultiSelect } from '@control-plane-metta/ui/multi-select';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@control-plane-metta/ui/page-dialog';
import { RecordActionBar } from '@control-plane-metta/ui/record-action-bar';
import { Textarea } from '@control-plane-metta/ui/textarea';
import { useConfirmation } from '@control-plane-metta/ui/use-confirmation';
import {
    useMutation,
    useQuery,
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
    FormErrorHeader,
    orpc,
    type ApiOutput,
} from '../../platform/shell/index.ts';

type ModuleGroup = ApiOutput<'listPackages'>['packages'][number];

const editAction = { id: 'edit', label: 'Ubah' };
const deleteAction = { id: 'delete', label: 'Delete', destructive: true };

// Kartu Baru dan Ubah susunan module.
function ModuleGroupCard({
    editing,
    onClose,
}: {
    editing: ModuleGroup | null;
    onClose: () => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const contentRef = useRef<HTMLDivElement>(null);
    const modules = useQuery(orpc.listModuleCatalog.queryOptions());
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
            onClose();
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
    const busy = create.isPending || update.isPending;
    return (
        <PageDialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <PageDialogContent
                ref={contentRef}
                title={editing ? editing.name : 'Susunan module baru'}
                editing
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
                <form
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
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
                        operation="Susunan module belum disimpan"
                    />
                    <PageDialogBody className="py-3">
                        <FormGrid>
                            <FormControl error={errors.name?.[0]}>
                                <Input
                                    label="Nama"
                                    required
                                    autoFocus
                                    maxLength={150}
                                    data-error-field="name"
                                    value={name}
                                    onChange={(event) =>
                                        setName(event.target.value)
                                    }
                                />
                            </FormControl>
                            <FormControl
                                error={errors.module_ids?.[0]}
                                hint="Module yang diberikan sekaligus saat susunan ini dipilih di Tambah module pada customer. Mengubah isinya tidak mengubah module customer yang sudah diberi susunan ini."
                            >
                                <div data-error-field="module_ids">
                                    <MultiSelect
                                        label="Module"
                                        searchPlaceholder="Cari module…"
                                        items={(
                                            modules.data?.modules ?? []
                                        ).map((module) => ({
                                            value: module.id,
                                            label: module.name,
                                        }))}
                                        value={moduleIds}
                                        onValueChange={setModuleIds}
                                        portalContainer={contentRef}
                                    />
                                </div>
                            </FormControl>
                            <FormControl error={errors.description?.[0]}>
                                <Textarea
                                    label="Deskripsi"
                                    maxLength={1000}
                                    data-error-field="description"
                                    value={description}
                                    onChange={(event) =>
                                        setDescription(event.target.value)
                                    }
                                />
                            </FormControl>
                        </FormGrid>
                    </PageDialogBody>
                </form>
            </PageDialogContent>
        </PageDialog>
    );
}

function ModuleGroupsPage(): ReactNode {
    const queryClient = useQueryClient();
    const { confirm, confirmation } = useConfirmation();
    const [card, setCard] = useState<{ editing: ModuleGroup | null } | null>(
        null,
    );
    const { data: groups } = useSuspenseQuery(
        orpc.listPackages.queryOptions({
            select: (response) => response.packages,
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
    async function askDelete(group: ModuleGroup) {
        if (
            await confirm({
                title: `Hapus susunan ${group.name}?`,
                description:
                    'Susunan ini tidak bisa dipilih lagi. Module customer yang pernah diberi susunan ini tetap ada.',
                confirmLabel: 'Delete',
                destructive: true,
            })
        )
            remove.mutate({ params: { package: group.id } });
    }
    return (
        <ListPageLayout
            header={
                <RecordActionBar title="Susunan module">
                    <ActionButton
                        action="create"
                        onClick={() => setCard({ editing: null })}
                    />
                </RecordActionBar>
            }
        >
            <DataTable
                data={groups}
                getRowKey={(group) => group.id}
                getRowLabel={(group) => group.name}
                emptyMessage="Belum ada susunan module. Pilih Baru untuk menyusun beberapa module yang biasa diberikan bersama, misalnya per jenis faskes."
                actions={[editAction, deleteAction]}
                onRowAction={(action, group) => {
                    if (action === editAction.id) setCard({ editing: group });
                    else void askDelete(group);
                }}
                columns={[
                    {
                        id: 'name',
                        header: 'Nama',
                        cell: (group) => (
                            <DataTableText>{group.name}</DataTableText>
                        ),
                        minWidth: 180,
                    },
                    {
                        id: 'modules',
                        header: 'Module',
                        cell: (group) => (
                            <DataTableText>
                                {group.modules
                                    .map((module) => module.name)
                                    .join(', ')}
                            </DataTableText>
                        ),
                        minWidth: 260,
                    },
                    {
                        id: 'description',
                        header: 'Deskripsi',
                        cell: (group) => (
                            <DataTableText>
                                {group.description ?? '-'}
                            </DataTableText>
                        ),
                        minWidth: 220,
                    },
                ]}
            />
            {confirmation}
            {card && (
                <ModuleGroupCard
                    editing={card.editing}
                    onClose={() => setCard(null)}
                />
            )}
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/catalog/module-groups',
    layout: 'app',
    title: 'Susunan module',
    component: ModuleGroupsPage,
});
