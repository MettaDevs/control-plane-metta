import {
    LoaderCircleIcon,
    PencilIcon,
    PlusIcon,
    SaveIcon,
    Trash2Icon,
    XIcon,
} from 'lucide-react';
import * as React from 'react';

import { cn } from '../utils';
import { Button } from './button';

/** Perintah record memakai label, ikon, dan tampilan yang sama pada setiap layar. */
const ACTION_INTENTS = {
    create: {
        icon: PlusIcon,
        label: 'Baru',
        pendingLabel: 'Membuat…',
        destructive: false,
    },
    add: {
        icon: PlusIcon,
        label: 'Tambah',
        pendingLabel: 'Menambahkan…',
        destructive: false,
    },
    edit: {
        icon: PencilIcon,
        label: 'Ubah',
        pendingLabel: 'Memproses…',
        destructive: false,
    },
    archive: {
        icon: Trash2Icon,
        label: 'Delete',
        pendingLabel: 'Memproses…',
        destructive: true,
    },
    delete: {
        icon: Trash2Icon,
        label: 'Delete',
        pendingLabel: 'Memproses…',
        destructive: true,
    },
    save: {
        icon: SaveIcon,
        label: 'Simpan',
        pendingLabel: 'Menyimpan…',
        destructive: false,
    },
    cancel: {
        icon: XIcon,
        label: 'Batal',
        pendingLabel: 'Memproses…',
        destructive: false,
    },
} as const;

type ActionIntent = keyof typeof ACTION_INTENTS;
type ActionButtonBaseProps = Omit<
    React.ComponentProps<typeof Button>,
    'variant' | 'children' | 'asChild' | 'type' | 'size'
> & {
    pending?: boolean;
    children?: never;
};

type ActionButtonProps = ActionButtonBaseProps &
    (
        | { action: 'save' | 'add'; type: 'submit' | 'button' }
        | { action: Exclude<ActionIntent, 'save' | 'add'>; type?: 'button' }
    );

function ActionButton({
    action,
    pending = false,
    disabled,
    type = 'button',
    className,
    ...props
}: ActionButtonProps) {
    const intent = ACTION_INTENTS[action];
    const Icon = pending ? LoaderCircleIcon : intent.icon;

    return (
        <Button
            {...props}
            data-slot="action-button"
            data-action={action}
            variant="ghost"
            asChild={false}
            type={type}
            size="command"
            disabled={disabled || pending}
            aria-busy={pending || undefined}
            className={cn(
                className,
                'h-7 gap-1.5 rounded-sm border-0 bg-transparent px-2 py-1 text-sm font-normal shadow-none',
                action === 'cancel' ? 'text-foreground' : 'text-primary',
                intent.destructive &&
                    'hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/30',
            )}
        >
            <Icon
                aria-hidden="true"
                className={pending ? 'animate-spin' : undefined}
            />
            {pending ? intent.pendingLabel : intent.label}
        </Button>
    );
}

export { ActionButton };
export type { ActionButtonProps, ActionIntent };
