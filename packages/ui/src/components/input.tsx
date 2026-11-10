import * as React from 'react';
import {
    documentLineLabel,
    useDocumentLineCell,
} from '../document-line-context';

import { cn } from '../utils';
import { useRecordEditActivation } from './record-edit-boundary';

type InputProps = React.ComponentProps<'input'> & {
    label?: string;
    /** Petunjuk format pada field berlabel muncul hanya saat fokus agar tidak menimpa label. */
    focusedPlaceholder?: string;
    /** Field hasil perhitungan/identitas yang selalu baca saja dapat menolak pemicu edit. */
    editActivation?: boolean;
};

function Input({
    className,
    type,
    id,
    label: providedLabel,
    placeholder,
    focusedPlaceholder,
    required,
    editActivation = true,
    onClick,
    onKeyDown,
    ...props
}: InputProps) {
    const cell = useDocumentLineCell();
    const label = cell && cell.compact !== false ? undefined : providedLabel;
    const generatedId = React.useId();
    const inputId = id ?? (label ? generatedId : undefined);
    const activation = useRecordEditActivation();
    const canActivate =
        editActivation &&
        props.readOnly &&
        !props.disabled &&
        activation?.canActivate;

    const input = (
        <input
            id={inputId}
            type={type}
            data-slot="input"
            data-document-control={
                cell && cell.compact !== false ? '' : undefined
            }
            required={required}
            placeholder={label ? (focusedPlaceholder ?? ' ') : placeholder}
            className={cn(
                'h-9 w-full min-w-0 rounded-md border border-[#d9dfe7] bg-white px-3 py-1 text-base text-[#1f2937] shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#8a94a6] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:border-input dark:bg-input/30 dark:text-foreground',
                'focus-visible:border-[#0284c7] focus-visible:ring-2 focus-visible:ring-[#0284c7]/15',
                'focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15',
                'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
                label && 'peer',
                label &&
                    focusedPlaceholder &&
                    'placeholder:text-transparent focus:placeholder:text-[#8a94a6]',
                className,
            )}
            {...props}
            aria-invalid={
                props['aria-invalid'] ?? (cell?.errorId ? true : undefined)
            }
            aria-describedby={props['aria-describedby'] ?? cell?.errorId}
            aria-label={
                props['aria-label'] ?? documentLineLabel(cell, providedLabel)
            }
            onClick={(event) => {
                onClick?.(event);

                if (!event.defaultPrevented && canActivate) {
                    activation?.activate(event.currentTarget, true);
                }
            }}
            onKeyDown={(event) => {
                onKeyDown?.(event);

                if (
                    !event.defaultPrevented &&
                    canActivate &&
                    !event.nativeEvent.isComposing &&
                    (event.key === 'Enter' || event.key === ' ') &&
                    activation?.activate(event.currentTarget, true)
                ) {
                    event.preventDefault();
                }
            }}
        />
    );

    if (!label) {
        return input;
    }

    return (
        <div className="relative w-full">
            {input}
            <label
                htmlFor={inputId}
                className={cn(
                    'absolute start-3 top-0 z-10 -translate-y-1/2 bg-white px-1 text-xs leading-none text-foreground transition-all duration-150 ease-out dark:bg-input/30',
                    'peer-placeholder-shown:top-1/2 peer-placeholder-shown:text-sm',
                    'peer-focus:top-0 peer-focus:text-xs peer-focus:text-foreground',
                    'peer-disabled:opacity-50 peer-aria-invalid:text-destructive',
                )}
            >
                {label}
                {required && <span className="text-destructive"> *</span>}
            </label>
        </div>
    );
}

export { Input };
