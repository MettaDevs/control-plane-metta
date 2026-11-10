import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../utils';

function NativeSelect({
    className,
    size = 'default',
    id,
    label,
    ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & {
    size?: 'sm' | 'default';
    label?: string;
}) {
    const generatedId = React.useId();
    const selectId = id ?? (label ? generatedId : undefined);

    return (
        <div
            className="group/native-select relative w-full has-[select:disabled]:opacity-50"
            data-slot="native-select-wrapper"
        >
            <select
                id={selectId}
                data-slot="native-select"
                data-size={size}
                className={cn(
                    'h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent px-3 py-2 pr-9 text-sm shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed data-[size=sm]:h-8 data-[size=sm]:py-1 dark:bg-input/30 dark:hover:bg-input/50',
                    'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
                    className,
                )}
                {...props}
            />
            {label && (
                <label
                    htmlFor={selectId}
                    className="pointer-events-none absolute start-3 top-0 z-10 -translate-y-1/2 bg-background px-1 text-xs leading-none text-foreground group-has-[select:disabled]/native-select:opacity-50 group-has-[select[aria-invalid=true]]/native-select:text-destructive"
                >
                    {label}
                </label>
            )}
            <ChevronDownIcon
                className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground opacity-50 select-none"
                aria-hidden="true"
                data-slot="native-select-icon"
            />
        </div>
    );
}

function NativeSelectOption({
    className,
    ...props
}: React.ComponentProps<'option'>) {
    return (
        <option
            data-slot="native-select-option"
            className={cn('bg-[Canvas] text-[CanvasText]', className)}
            {...props}
        />
    );
}

function NativeSelectOptGroup({
    className,
    ...props
}: React.ComponentProps<'optgroup'>) {
    return (
        <optgroup
            data-slot="native-select-optgroup"
            className={cn('bg-[Canvas] text-[CanvasText]', className)}
            {...props}
        />
    );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
