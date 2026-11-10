import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { CircleAlert } from 'lucide-react';
import { useMemo } from 'react';

import { cn } from '../utils';
import { Label } from './label';
import { Separator } from './separator';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from './tooltip';

/**
 * Penjelasan tambahan satu field, tersembunyi sampai diminta.
 *
 * Sebuah form yang menampilkan penjelasan setiap field sekaligus, permanen, di bawah tiap
 * kontrol, terbaca sebagai dinding teks abu-abu — bukan bantuan. `FieldHint` menahannya di
 * balik `children` yang dibungkusnya: hover sebentar untuk mengintip, klik untuk menahannya
 * tetap terbuka, klik lagi untuk menutup. `children` biasanya sebuah ikon kecil yang dipasang
 * caller di sebelah kontrolnya, bukan kontrolnya sendiri — pernah dicoba membungkus seluruh
 * field sebagai target hover supaya tidak perlu mengarahkan kursor presisi ke ikon, tetapi
 * itu membuat tooltip terpicu setiap kali kursor sekadar lewat menuju kontrolnya. Ikon
 * terpisah, sekecil apa pun, tidak bertumpang tindih dengan area yang dipakai untuk
 * benar-benar berinteraksi dengan field-nya.
 *
 * Karena triggernya sebuah tombol sungguhan, klik-untuk-menahan berjalan lewat keyboard juga
 * (fokus ke tombol lalu Enter/Space), tanpa kode tambahan.
 *
 * Delay hover-nya SENGAJA dibungkus `TooltipProvider` miliknya sendiri, bukan mengandalkan
 * provider milik app pemanggil. App boleh menyetel delay tooltip lain jadi instan untuk
 * kebutuhannya sendiri; kontrak "tunggu sekitar satu detik" milik hint tetap harus berlaku
 * di app mana pun komponen ini dipasang.
 */
function FieldHint({
    hint,
    children,
    side = 'top',
    className,
}: {
    /** Isi penjelasannya. */
    hint: React.ReactNode;
    /** Triggernya — biasanya ikon kecil di sebelah kontrol, bukan kontrol itu sendiri. */
    children: React.ReactNode;
    side?: 'top' | 'right' | 'bottom' | 'left';
    className?: string;
}) {
    return (
        <TooltipProvider delayDuration={1000}>
            <Tooltip clickToPin>
                <TooltipTrigger asChild>
                    <div
                        data-slot="field-hint-trigger"
                        className={cn('min-w-0', className)}
                    >
                        {children}
                    </div>
                </TooltipTrigger>
                <TooltipContent side={side} className="max-w-72">
                    {hint}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
    return (
        <fieldset
            data-slot="field-set"
            className={cn(
                'flex flex-col gap-6',
                'has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3',
                className,
            )}
            {...props}
        />
    );
}

function FieldLegend({
    className,
    variant = 'legend',
    hint,
    children,
    ...props
}: React.ComponentProps<'legend'> & {
    variant?: 'legend' | 'label';
    hint?: React.ReactNode;
}) {
    return (
        <legend
            data-slot="field-legend"
            data-variant={variant}
            className={cn(
                'mb-3 font-medium',
                'data-[variant=legend]:text-base',
                'data-[variant=label]:text-sm',
                className,
            )}
            {...props}
        >
            <span className="inline-flex items-center gap-1">
                {children}
                {hint && (
                    <FieldHint hint={hint} side="right" className="inline-flex">
                        {/* Judul seksi bukan kontrol yang bisa disunting, jadi ikon di sini tetap
                menjadi target hover — tidak ada field untuk dibungkus seperti pada
                `DynamicField`. Tetap tombol sungguhan supaya Tab dapat menjangkaunya. */}
                        <button
                            type="button"
                            aria-label="Lihat penjelasan"
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                            <CircleAlert className="size-4" />
                        </button>
                    </FieldHint>
                )}
            </span>
        </legend>
    );
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="field-group"
            className={cn(
                'group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4',
                className,
            )}
            {...props}
        />
    );
}

const fieldVariants = cva(
    'group/field flex w-full gap-3 data-[invalid=true]:text-destructive',
    {
        variants: {
            orientation: {
                vertical: ['flex-col [&>*]:w-full [&>.sr-only]:w-auto'],
                horizontal: [
                    'flex-row items-center',
                    '[&>[data-slot=field-label]]:flex-auto',
                    'has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
                ],
                responsive: [
                    'flex-col @md/field-group:flex-row @md/field-group:items-center [&>*]:w-full @md/field-group:[&>*]:w-auto [&>.sr-only]:w-auto',
                    '@md/field-group:[&>[data-slot=field-label]]:flex-auto',
                    '@md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
                ],
            },
        },
        defaultVariants: {
            orientation: 'vertical',
        },
    },
);

function Field({
    className,
    orientation = 'vertical',
    ...props
}: React.ComponentProps<'div'> & VariantProps<typeof fieldVariants>) {
    return (
        <div
            role="group"
            data-slot="field"
            data-orientation={orientation}
            className={cn(fieldVariants({ orientation }), className)}
            {...props}
        />
    );
}

function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="field-content"
            className={cn(
                'group/field-content flex flex-1 flex-col gap-1.5 leading-snug',
                className,
            )}
            {...props}
        />
    );
}

function FieldLabel({
    className,
    ...props
}: React.ComponentProps<typeof Label>) {
    return (
        <Label
            data-slot="field-label"
            className={cn(
                'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50',
                'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>*]:data-[slot=field]:p-4',
                'has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 dark:has-data-[state=checked]:bg-primary/10',
                className,
            )}
            {...props}
        />
    );
}

function FieldTitle({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="field-label"
            className={cn(
                'flex w-fit items-center gap-2 text-sm leading-snug font-medium group-data-[disabled=true]/field:opacity-50',
                className,
            )}
            {...props}
        />
    );
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
    return (
        <p
            data-slot="field-description"
            className={cn(
                'text-sm leading-normal font-normal text-muted-foreground group-has-[[data-orientation=horizontal]]/field:text-balance',
                'last:mt-0 nth-last-2:-mt-1 [[data-variant=legend]+&]:-mt-1.5',
                '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
                className,
            )}
            {...props}
        />
    );
}

function FieldSeparator({
    children,
    className,
    ...props
}: React.ComponentProps<'div'> & {
    children?: React.ReactNode;
}) {
    return (
        <div
            data-slot="field-separator"
            data-content={!!children}
            className={cn(
                'relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2',
                className,
            )}
            {...props}
        >
            <Separator className="absolute inset-0 top-1/2" />
            {children && (
                <span
                    className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
                    data-slot="field-separator-content"
                >
                    {children}
                </span>
            )}
        </div>
    );
}

function FieldError({
    className,
    children,
    errors,
    ...props
}: React.ComponentProps<'div'> & {
    errors?: Array<{ message?: string } | undefined>;
}) {
    const content = useMemo(() => {
        if (children) {
            return children;
        }

        if (!errors?.length) {
            return null;
        }

        const uniqueErrors = [
            ...new Map(errors.map((error) => [error?.message, error])).values(),
        ];

        if (uniqueErrors?.length == 1) {
            return uniqueErrors[0]?.message;
        }

        return (
            <ul className="ml-4 flex list-disc flex-col gap-1">
                {uniqueErrors.map(
                    (error, index) =>
                        error?.message && <li key={index}>{error.message}</li>,
                )}
            </ul>
        );
    }, [children, errors]);

    if (!content) {
        return null;
    }

    return (
        <div
            role="alert"
            data-slot="field-error"
            className={cn('text-sm font-normal text-destructive', className)}
            {...props}
        >
            {content}
        </div>
    );
}

export {
    Field,
    FieldLabel,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldHint,
    FieldLegend,
    FieldSeparator,
    FieldSet,
    FieldContent,
    FieldTitle,
};
