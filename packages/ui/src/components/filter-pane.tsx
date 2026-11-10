import { X } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../utils';
import { Button } from './button';

/** Kerangka filter bersama; isian, query, dan preset tetap dimiliki halaman. */
export function FilterPane({
    id,
    title,
    description,
    onClose,
    side = 'left',
    children,
    className,
}: {
    id: string;
    title: string;
    description?: ReactNode;
    onClose: () => void;
    side?: 'left' | 'right';
    children: ReactNode;
    className?: string;
}) {
    const titleId = useId();

    return (
        <aside
            id={id}
            data-slot="filter-pane"
            aria-labelledby={titleId}
            className={cn(
                'flex max-h-72 min-h-0 w-full shrink-0 flex-col border-t bg-background lg:max-h-none lg:w-80 lg:border-t-0 xl:w-96',
                side === 'left' ? 'lg:border-r' : 'lg:border-l',
                className,
            )}
        >
            <header
                data-slot="filter-pane-header"
                className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3"
            >
                <div className="min-w-0">
                    <h2 id={titleId} className="text-sm font-semibold">
                        {title}
                    </h2>
                    {description && (
                        <div className="text-xs text-muted-foreground">
                            {description}
                        </div>
                    )}
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Tutup ${title.toLocaleLowerCase('id-ID')}`}
                    onClick={onClose}
                >
                    <X aria-hidden="true" />
                </Button>
            </header>
            <div
                data-slot="filter-pane-body"
                className="min-h-0 flex-1 overflow-y-auto"
            >
                {children}
            </div>
        </aside>
    );
}
