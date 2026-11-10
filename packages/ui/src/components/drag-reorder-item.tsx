import * as React from 'react';
import { cn } from '../utils';

type DropEdge = 'before' | 'after';
type DragReorderItemProps = Omit<
    React.ComponentProps<'div'>,
    'onDrop' | 'onDragStart' | 'onDragOver' | 'onDragEnd' | 'onDragLeave'
> & {
    payload: string;
    preview: string;
    mimeType: string;
    onDropItem: (payload: string, edge: DropEdge) => void;
};
/** Item seret bersama: ghost berlabel dan penanda sisip atas/bawah, tanpa mengubah urutan saat hover. */
function DragReorderItem({
    payload,
    preview,
    mimeType,
    onDropItem,
    className,
    children,
    ...props
}: DragReorderItemProps) {
    const [edge, setEdge] = React.useState<DropEdge | null>(null);
    const [dragging, setDragging] = React.useState(false);

    return (
        <div
            {...props}
            draggable
            className={cn('relative', dragging && 'opacity-50', className)}
            onDragStart={(event) => {
                event.dataTransfer.setData(mimeType, payload);
                event.dataTransfer.effectAllowed = 'copyMove';
                const ghost = document.createElement('div');
                ghost.textContent = preview;
                ghost.className =
                    'fixed -left-[9999px] rounded border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md';
                document.body.appendChild(ghost);
                event.dataTransfer.setDragImage(ghost, 10, 10);
                requestAnimationFrame(() => ghost.remove());
                setDragging(true);
            }}
            onDragEnd={() => {
                setDragging(false);
                setEdge(null);
            }}
            onDragOver={(event) => {
                if (!Array.from(event.dataTransfer.types).includes(mimeType)) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setEdge(
                    event.clientY < rect.top + rect.height / 2
                        ? 'before'
                        : 'after',
                );
            }}
            onDragLeave={(event) => {
                if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                ) {
                    setEdge(null);
                }
            }}
            onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                const position =
                    event.clientY < rect.top + rect.height / 2
                        ? 'before'
                        : 'after';
                const data = event.dataTransfer.getData(mimeType);
                setEdge(null);

                if (data) {
                    onDropItem(data, position);
                }
            }}
        >
            {edge && (
                <span
                    aria-hidden
                    className={cn(
                        'pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary',
                        edge === 'before' ? 'top-0' : 'bottom-0',
                    )}
                />
            )}
            {children}
        </div>
    );
}
export { DragReorderItem };
export type { DropEdge, DragReorderItemProps };
