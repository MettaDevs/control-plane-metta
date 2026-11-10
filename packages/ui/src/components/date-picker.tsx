import { CalendarIcon } from 'lucide-react';
import * as React from 'react';
import { id as indonesian } from 'react-day-picker/locale';

import { Button } from './button';
import { Calendar } from './calendar';
import { Input } from './input';
import {
    Popover,
    PopoverAnchor,
    PopoverContent,
    PopoverTrigger,
} from './popover';

/** Tanggal kalender lokal, tanpa konversi UTC yang menggeser hari. */
export function parseDate(value: string): Date | undefined {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!parts) {
        return undefined;
    }

    const [, year, month, day] = parts;
    const date = new Date(0);
    date.setFullYear(Number(year), Number(month) - 1, Number(day));
    date.setHours(0, 0, 0, 0);

    return Number(year) >= 1 &&
        date.getFullYear() === Number(year) &&
        date.getMonth() === Number(month) - 1 &&
        date.getDate() === Number(day)
        ? date
        : undefined;
}

export function dateValue(date: Date): string {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDateInput(text: string): string | undefined {
    if (!text.trim()) {
        return '';
    }

    const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
    const iso = parts
        ? `${parts[3]}-${parts[2]!.padStart(2, '0')}-${parts[1]!.padStart(2, '0')}`
        : text.trim();

    return parseDate(iso) ? iso : undefined;
}

/** Tanggal ISO sebagai dd/mm/yyyy, bentuk yang sama dengan isian DatePicker; teks lain dikembalikan apa adanya. */
export function displayDate(value: string): string {
    return parseDate(value) ? value.split('-').reverse().join('/') : value;
}

/** Pemisah mengikuti ketikan; penghapusan tidak memasang kembali slash di ujung. */
export function formatDateInput(
    text: string,
    caret = text.length,
    inputType = 'insertText',
): { text: string; caret: number } {
    const trimmed = text.trim();
    let formatted = trimmed;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        formatted = trimmed.split('-').reverse().join('/');
    } else if (/^[\d/]*$/.test(trimmed)) {
        const parts = trimmed.split('/');

        if (parts.length === 1 && trimmed.length <= 8) {
            formatted = [
                trimmed.slice(0, 2),
                trimmed.slice(2, 4),
                trimmed.slice(4),
            ]
                .filter(Boolean)
                .join('/');
        }

        if (
            !inputType.startsWith('delete') &&
            /^(\d{2}|\d{1,2}\/\d{2})$/.test(formatted)
        ) {
            formatted += '/';
        }
    }

    if (caret === text.length) {
        return { text: formatted, caret: formatted.length };
    }

    const digitsBeforeCaret = text.slice(0, caret).replace(/\D/g, '').length;
    let nextCaret = 0;
    let digits = 0;

    while (nextCaret < formatted.length && digits < digitsBeforeCaret) {
        if (/\d/.test(formatted[nextCaret]!)) {
            digits += 1;
        }

        nextCaret += 1;
    }

    return { text: formatted, caret: nextCaret };
}

type DatePickerProps = Omit<
    React.ComponentProps<typeof Input>,
    'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'
> & {
    value?: string;
    defaultValue?: string;
    /** Tanggal sah menjadi ISO; teks yang belum sah tetap menjadi draft induk agar tidak hilang saat bagian ditutup. */
    onValueChange?: (value: string) => void;
    min?: string;
    max?: string;
    portalContainer?: HTMLElement | null | React.RefObject<HTMLElement | null>;
};

/** Input dan Calendar SDK menjaga format tanggal serta portal overlay tetap sama di semua form. */
export function DatePicker({
    value,
    defaultValue = '',
    onValueChange,
    name,
    disabled,
    readOnly,
    min,
    max,
    portalContainer,
    onBlur,
    onKeyDown,
    ...props
}: DatePickerProps) {
    const [internalValue, setInternalValue] = React.useState(defaultValue);
    const committed = value ?? internalValue;
    const [draft, setDraft] = React.useState({
        source: committed,
        text: displayDate(committed),
    });
    const [open, setOpen] = React.useState(false);
    const [host, setHost] = React.useState<HTMLDivElement | null>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const text =
        draft.source === committed ? draft.text : displayDate(committed);
    const parsed = parseDateInput(text);
    const invalid =
        parsed === undefined ||
        Boolean(parsed && ((min && parsed < min) || (max && parsed > max)));
    const selected = parseDate(committed);
    const earliest = parseDate(min ?? '');
    const latest = parseDate(max ?? '');
    const explicitContainer =
        portalContainer && 'current' in portalContainer
            ? portalContainer.current
            : portalContainer;
    const container =
        explicitContainer ??
        host?.closest<HTMLElement>(
            '[data-slot="page-dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-content"], [data-slot="popover-content"]',
        );

    function commit(next: string) {
        setInternalValue(next);
        setDraft({ source: next, text: displayDate(next) });
        onValueChange?.(next);
    }

    React.useLayoutEffect(() => {
        inputRef.current?.setCustomValidity(
            invalid
                ? 'Masukkan tanggal yang valid (dd/mm/yyyy) dalam rentang yang diizinkan.'
                : '',
        );
    }, [invalid]);

    return (
        <Popover open={open && !disabled && !readOnly} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <div
                    ref={setHost}
                    className="relative w-full"
                    data-slot="date-picker"
                >
                    <Input
                        {...props}
                        ref={inputRef}
                        type="text"
                        inputMode="numeric"
                        placeholder="dd/mm/yyyy"
                        focusedPlaceholder="dd/mm/yyyy"
                        autoComplete="off"
                        disabled={disabled}
                        readOnly={readOnly}
                        value={text}
                        className={[props.className, 'pe-10']
                            .filter(Boolean)
                            .join(' ')}
                        onChange={(event) => {
                            const inputType =
                                'inputType' in event.nativeEvent &&
                                typeof event.nativeEvent.inputType === 'string'
                                    ? event.nativeEvent.inputType
                                    : 'insertText';
                            const formatted = formatDateInput(
                                event.target.value,
                                event.target.selectionStart ??
                                    event.target.value.length,
                                inputType,
                            );
                            const nextText = formatted.text;
                            const next = parseDateInput(nextText) ?? nextText;
                            setInternalValue(next);
                            setDraft({ source: next, text: nextText });
                            onValueChange?.(next);
                            const input = event.target;
                            requestAnimationFrame(() => {
                                if (input === document.activeElement) {
                                    input.setSelectionRange(
                                        formatted.caret,
                                        formatted.caret,
                                    );
                                }
                            });
                        }}
                        onBlur={(event) => {
                            if (parsed !== undefined) {
                                commit(parsed);
                            }

                            onBlur?.(event);
                        }}
                        onKeyDown={(event) => {
                            onKeyDown?.(event);

                            const input = event.currentTarget;
                            const caret = input.selectionStart;

                            if (
                                !event.defaultPrevented &&
                                caret !== null &&
                                caret === input.selectionEnd &&
                                !readOnly
                            ) {
                                if (
                                    event.key === 'Backspace' &&
                                    text[caret - 1] === '/'
                                ) {
                                    input.setSelectionRange(
                                        caret - 1,
                                        caret - 1,
                                    );
                                }

                                if (
                                    event.key === 'Delete' &&
                                    text[caret] === '/'
                                ) {
                                    input.setSelectionRange(
                                        caret + 1,
                                        caret + 1,
                                    );
                                }
                            }

                            if (
                                !event.defaultPrevented &&
                                event.key === 'ArrowDown' &&
                                !readOnly
                            ) {
                                event.preventDefault();
                                setOpen(true);
                            }
                        }}
                    />
                    <input
                        type="hidden"
                        name={name}
                        form={props.form}
                        value={parsed ?? ''}
                        disabled={disabled}
                    />
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="absolute end-1 top-1/2 -translate-y-1/2"
                            disabled={disabled || readOnly}
                            aria-label={`Pilih tanggal${props.label ? `: ${props.label}` : ''}`}
                        >
                            <CalendarIcon aria-hidden="true" />
                        </Button>
                    </PopoverTrigger>
                </div>
            </PopoverAnchor>
            <PopoverContent
                align="start"
                className="w-auto p-0"
                portalContainer={container}
            >
                <Calendar
                    mode="single"
                    locale={indonesian}
                    selected={selected}
                    defaultMonth={selected}
                    autoFocus
                    startMonth={earliest}
                    endMonth={latest}
                    disabled={[
                        ...(earliest ? [{ before: earliest }] : []),
                        ...(latest ? [{ after: latest }] : []),
                    ]}
                    onSelect={(date) => {
                        if (date) {
                            commit(dateValue(date));
                            setOpen(false);
                        }
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
