import { Info } from 'lucide-react';
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import {
    DocumentLineCellContext,
    useDocumentLineCell,
} from '../document-line-context';
import { cn } from '../utils';
import { Button } from './button';
import { FieldError, FieldHint } from './field';

/** Ruang kontrol dan bantuan selalu sama; error tetap terlihat di bawah kontrol. */
export function FormControl({
    children,
    hint,
    error,
    hintLabel = 'Bantuan field',
    className,
    ...props
}: ComponentProps<'div'> & {
    children: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    hintLabel?: string;
    className?: string;
}) {
    const cell = useDocumentLineCell();
    const errorId = useId();

    return (
        <div
            role="group"
            data-slot="form-control"
            data-document-cell={cell && cell.compact !== false ? '' : undefined}
            data-has-hint={hint ? '' : undefined}
            className={cn(className)}
            {...props}
        >
            <div data-slot="form-control-body">
                <DocumentLineCellContext.Provider
                    value={
                        cell
                            ? { ...cell, errorId: error ? errorId : undefined }
                            : null
                    }
                >
                    {children}
                </DocumentLineCellContext.Provider>
            </div>
            <div data-slot="form-control-help" aria-hidden={!hint || undefined}>
                {hint && (
                    <FieldHint hint={hint} side="right">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={hintLabel}
                        >
                            <Info aria-hidden="true" />
                        </Button>
                    </FieldHint>
                )}
            </div>
            {error && <FieldError id={errorId}>{error}</FieldError>}
        </div>
    );
}

/** Satu jarak antar-kontrol dan ruang floating label untuk semua bagian form. */
export function FormGrid({
    className,
    columns = 2,
    ...props
}: ComponentProps<'div'> & { columns?: 1 | 2 }) {
    return (
        <div
            data-slot="form-grid"
            data-columns={columns}
            className={cn(className)}
            {...props}
        />
    );
}
