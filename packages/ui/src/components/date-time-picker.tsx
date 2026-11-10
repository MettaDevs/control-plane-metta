import type { ComponentProps } from 'react';
import { DatePicker } from './date-picker';
import { Input } from './input';

/** Tanggal kalender dan waktu lokal memakai kontrol SDK yang sama dengan form lain. */
export function DateTimePicker({
    value,
    onValueChange,
    ...props
}: Omit<ComponentProps<typeof DatePicker>, 'value' | 'onValueChange'> & {
    value: string;
    onValueChange: (value: string) => void;
}) {
    const separator = value.indexOf('T');
    const date = separator < 0 ? value : value.slice(0, separator);
    const time = separator < 0 ? '' : value.slice(separator + 1);

    return (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <DatePicker
                {...props}
                value={date}
                onValueChange={(next) =>
                    onValueChange(next ? `${next}T${time || '00:00'}` : '')
                }
            />
            <Input
                label="Waktu"
                type="time"
                value={time}
                required={props.required && Boolean(date)}
                readOnly={props.readOnly}
                disabled={props.disabled}
                onChange={(event) =>
                    onValueChange(date ? `${date}T${event.target.value}` : '')
                }
            />
        </div>
    );
}
