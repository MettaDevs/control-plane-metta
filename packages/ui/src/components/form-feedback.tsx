import { ChevronDown, ChevronUp, CircleAlert, X } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { Alert, AlertDescription, AlertTitle } from './alert';
import { Button } from './button';
import { FieldError } from './field';
import { Textarea } from './textarea';

export type FormFeedback = {
    title: string;
    message: string;
    issues?: readonly { field: string; message: string }[];
    actions?: readonly { label: string; onClick: () => void }[];
    details?: string;
    focusSummary?: boolean;
};

export type SaveFeedbackInput = {
    operation: string;
    message: string;
    status?: number;
    code?: string | null;
    errors?: Record<string, string[] | string>;
    details?: string;
    actions?: FormFeedback['actions'];
};

/** Membaca validity tanpa menyalakan popup browser; pemanggil menampilkan hasil di header dan field. */
export function getFormValidationErrors(
    scope: HTMLElement,
): Record<string, string[]> {
    const errors: Record<string, string[]> = {};
    const controls = scope.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input, select, textarea');

    for (const control of controls) {
        if (!control.willValidate || control.validity.valid) {
            continue;
        }

        const field =
            control.name ||
            control.closest<HTMLElement>('[data-error-field]')?.dataset
                .errorField ||
            control.id;

        if (!field) {
            continue;
        }

        const label = (
            control.labels?.[0]?.textContent ||
            control.getAttribute('aria-label') ||
            'Isian ini'
        )
            .replace(/\*/g, '')
            .trim();
        let message = `${label}: periksa nilai dan format isian.`;

        if (control.validity.customError) {
            message = control.validationMessage;
        } else if (control.validity.valueMissing) {
            message = `Isi ${label.toLocaleLowerCase('id-ID')} sebelum melanjutkan.`;
        } else if (
            control.validity.typeMismatch &&
            control.getAttribute('type') === 'email'
        ) {
            message = 'Isi alamat email yang lengkap, termasuk @ dan domain.';
        } else if (control.validity.badInput) {
            message = `${label}: gunakan angka yang valid.`;
        } else if (control.validity.rangeUnderflow) {
            message = `${label}: isi nilai minimal ${control.getAttribute('min')}.`;
        } else if (control.validity.rangeOverflow) {
            message = `${label}: isi nilai maksimal ${control.getAttribute('max')}.`;
        } else if (control.validity.stepMismatch) {
            message = `${label}: gunakan kelipatan ${control.getAttribute('step') || 'yang diizinkan'}.`;
        } else if (control.validity.tooLong) {
            message = `${label}: gunakan paling banyak ${control.getAttribute('maxlength')} karakter.`;
        }

        errors[field] = [...(errors[field] ?? []), message];
    }

    return errors;
}

export function validateFormSubmission(
    scope: HTMLElement,
    event: Pick<Event, 'preventDefault' | 'stopImmediatePropagation'>,
) {
    const errors = getFormValidationErrors(scope);

    if (Object.keys(errors).length) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    return errors;
}

export function useFormValidation(
    scopeRef: React.RefObject<HTMLElement | null>,
    scopeKey: string | number | null = null,
) {
    const [state, setState] = React.useState<{
        key: string | number | null;
        signature: string;
        feedback: FormFeedback;
    } | null>(null);

    if (state && state.key !== scopeKey) {
        setState(null);
    }

    React.useEffect(() => {
        const scope = scopeRef.current;
        const form = scope?.matches('form')
            ? scope
            : scope?.querySelector<HTMLElement>('form');

        if (!form) {
            return;
        }

        let active = state?.key === scopeKey;
        let frame = 0;
        const show = (errors: Record<string, string[]>, focus: boolean) => {
            const signature = JSON.stringify(errors);
            active = Object.keys(errors).length > 0;

            if (!active) {
                setState(null);

                return;
            }

            setState((current) =>
                !focus &&
                current?.signature === signature &&
                current.key === scopeKey
                    ? current
                    : {
                          key: scopeKey,
                          signature,
                          feedback: {
                              ...createSaveFeedback({
                                  operation:
                                      'Periksa isian sebelum melanjutkan',
                                  message: 'Perbaiki isian yang ditandai.',
                                  errors,
                              }),
                              focusSummary: focus,
                          },
                      },
            );
        };
        const submit = (event: Event) =>
            show(validateFormSubmission(form, event), true);
        const revalidate = () => {
            if (!active) {
                return;
            }

            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() =>
                show(getFormValidationErrors(form), false),
            );
        };
        form.addEventListener('submit', submit, true);
        form.addEventListener('input', revalidate);
        form.addEventListener('change', revalidate);
        const observer = new MutationObserver(revalidate);
        observer.observe(form, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: [
                'value',
                'disabled',
                'required',
                'min',
                'max',
                'name',
            ],
        });

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            form.removeEventListener('submit', submit, true);
            form.removeEventListener('input', revalidate);
            form.removeEventListener('change', revalidate);
        };
    });

    return state?.key === scopeKey ? state.feedback : null;
}

/** Pemanggil menyediakan fakta dan tindakan domain; SDK hanya menyeragamkan penyajiannya. */
export function createSaveFeedback(input: SaveFeedbackInput): FormFeedback {
    const issues = Object.entries(input.errors ?? {}).flatMap(
        ([field, value]) =>
            (Array.isArray(value) ? value : [value])
                .filter((message) => message.length > 0)
                .map((message) => ({ field, message })),
    );
    const common = {
        actions: input.actions,
        details: input.details,
    };

    if (input.status && input.status >= 500) {
        return {
            ...common,
            title: input.operation.replace(/[.!?]+$/, ''),
            details:
                input.details?.trim() ||
                [
                    input.operation,
                    `Status HTTP: ${input.status}`,
                    input.code ? `Kode: ${input.code}` : '',
                ]
                    .filter(Boolean)
                    .join('\n'),
            message:
                'Terjadi gangguan sistem. Isian masih tersedia di form. Salin detail bantuan untuk pengelola aplikasi agar penyebabnya dapat diperiksa.',
        };
    }

    if (input.code === 'stale_version') {
        return {
            ...common,
            title: 'Data sudah berubah sejak dibuka',
            message:
                'Perubahan kamu belum tersimpan. Tinjau data terbaru sebelum menyimpan lagi. Isianmu tetap tersedia; jangan muat ulang sebelum mengamankan perubahanmu.',
        };
    }

    if (input.status === 401 || input.status === 419) {
        return {
            ...common,
            title: 'Sesi login sudah berakhir',
            message:
                'Masuk kembali sebelum melanjutkan. Isian masih ada selama form terbuka. Amankan isian sebelum berpindah atau memuat ulang halaman.',
        };
    }

    if (input.status === 403) {
        return {
            ...common,
            title: 'Kamu belum memiliki akses untuk tindakan ini',
            message:
                'Minta pengelola akun memeriksa aksesmu. Mengulang tindakan yang sama tidak mengubah hak akses. Isian tetap tersedia di form.',
        };
    }

    if (input.status === 413) {
        return {
            ...common,
            title: 'Berkas melebihi batas upload',
            message:
                'Pilih berkas yang lebih kecil sesuai batas upload pada form, lalu upload kembali.',
            issues,
        };
    }

    if (input.status === 415) {
        return {
            ...common,
            title: 'Format berkas belum didukung',
            message:
                'Pilih berkas dengan format yang diizinkan pada form, lalu upload kembali.',
            issues,
        };
    }

    return {
        ...common,
        title: issues.length
            ? `Periksa ${new Set(issues.map((issue) => issue.field)).size} isian yang perlu diperbaiki`
            : input.operation.replace(/[.!?]+$/, ''),
        message: issues.length
            ? 'Periksa isian yang ditandai, lalu ulangi tindakan ini setelah diperbaiki.'
            : input.message || input.operation,
        issues,
    };
}

function findFeedbackControl(
    scope: HTMLElement,
    field: string,
): HTMLElement | null {
    const candidates = scope.querySelectorAll<HTMLElement>(
        '[name], [id], [data-error-field]',
    );
    const elements = Array.from(candidates ?? []);
    const matched =
        elements.find(
            (element) =>
                element.getAttribute('name') === field ||
                element.id === field ||
                element.getAttribute('data-error-field') === field,
        ) ??
        elements
            .filter((element) => {
                const prefix = element.getAttribute('data-error-field');

                return !!prefix && field.startsWith(`${prefix}.`);
            })
            .sort(
                (left, right) =>
                    (right.getAttribute('data-error-field')?.length ?? 0) -
                    (left.getAttribute('data-error-field')?.length ?? 0),
            )[0];
    const focusable =
        'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"]):not([aria-disabled="true"]), [role="combobox"]:not([aria-disabled="true"])';
    const target = matched?.matches(focusable)
        ? matched
        : matched?.querySelector<HTMLElement>(focusable);

    if (
        !target ||
        target.matches(
            ':disabled, [aria-disabled="true"], input[type="hidden"]',
        ) ||
        target.closest('[hidden], [inert]')
    ) {
        return null;
    }

    return target;
}

export function focusFeedbackField(scope: HTMLElement, field: string): boolean {
    const target = findFeedbackControl(scope, field);

    if (!target) {
        return false;
    }

    let ancestor = target.parentElement;

    while (ancestor && ancestor !== scope) {
        if (ancestor instanceof HTMLDetailsElement) {
            ancestor.open = true;
        }

        ancestor = ancestor.parentElement;
    }

    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.focus({ preventScroll: true });

    return true;
}

export type FormFeedbackCollection =
    FormFeedback | readonly (FormFeedback | null)[] | null;

function formFeedbackKey(feedback: FormFeedback): string {
    return JSON.stringify([
        feedback.title,
        feedback.message,
        feedback.issues,
        feedback.details,
        feedback.actions?.map((action) => action.label),
    ]);
}

export function collectFormFeedback(
    value: FormFeedbackCollection,
): FormFeedback[] {
    const values: readonly (FormFeedback | null)[] =
        value === null ? [] : 'title' in value ? [value] : value;
    const unique = new Map<string, FormFeedback>();

    for (const feedback of values) {
        if (!feedback) {
            continue;
        }

        const key = formFeedbackKey(feedback);

        if (!unique.has(key)) {
            unique.set(key, feedback);
        }
    }

    return [...unique.values()];
}

type FormErrorSummaryProps = {
    feedback: FormFeedbackCollection;
    scopeRef?: React.RefObject<HTMLElement | null>;
    onFocusField?: (field: string) => void;
};

/** Ringkasan milik satu form; navigasi field dan hasil salin tidak dibagikan ke form lain. */
export function FormErrorSummary({
    feedback: providedFeedback,
    scopeRef,
    onFocusField,
}: FormErrorSummaryProps) {
    const entries = React.useMemo(
        () => collectFormFeedback(providedFeedback),
        [providedFeedback],
    );
    const feedback = React.useMemo(
        () =>
            entries.length
                ? {
                      ...entries[0]!,
                      issues: entries.flatMap((entry) => entry.issues ?? []),
                      focusSummary: entries.some(
                          (entry) => entry.focusSummary !== false,
                      ),
                  }
                : null,
        [entries],
    );
    const summaryRef = React.useRef<HTMLDivElement>(null);
    const previousEntries = React.useRef<readonly FormFeedback[]>([]);
    const inlineId = React.useId();
    const [inlineFields, setInlineFields] = React.useState<{
        feedback: FormFeedback;
        fields: {
            target: HTMLElement;
            id: string;
            messages: string[];
            field: string;
        }[];
    } | null>(null);

    React.useEffect(() => {
        const shouldFocus = entries.some(
            (entry) =>
                entry.focusSummary !== false &&
                !previousEntries.current.includes(entry),
        );
        previousEntries.current = entries;

        if (shouldFocus) {
            summaryRef.current?.focus({ preventScroll: true });
        }
    }, [entries]);

    React.useEffect(() => {
        const scope = scopeRef?.current;

        if (!feedback || !scope || !feedback.issues?.length) {
            return;
        }

        const cleanups: (() => void)[] = [];
        const frame = requestAnimationFrame(() => {
            const fields: {
                target: HTMLElement;
                id: string;
                messages: string[];
                field: string;
            }[] = [];
            const messages = new Map<
                HTMLElement,
                { field: string; messages: string[] }
            >();

            for (const issue of feedback.issues ?? []) {
                const control = findFeedbackControl(scope, issue.field);

                if (!control) {
                    continue;
                }

                const existing = messages.get(control);

                if (existing) {
                    if (!existing.messages.includes(issue.message)) {
                        existing.messages.push(issue.message);
                    }
                } else {
                    messages.set(control, {
                        field: issue.field,
                        messages: [issue.message],
                    });
                }
            }

            for (const [control, issue] of messages) {
                const group =
                    control.closest<HTMLElement>(
                        '[data-slot="form-control"], [data-slot="field"]',
                    ) ?? control.parentElement;

                if (
                    !group ||
                    group.querySelector('[data-slot="field-error"]')
                ) {
                    continue;
                }

                const id = `${inlineId}-${fields.length}`;
                const originalInvalid = control.getAttribute('aria-invalid');
                control.setAttribute('aria-invalid', 'true');
                control.setAttribute(
                    'aria-describedby',
                    [
                        ...new Set([
                            ...(control.getAttribute('aria-describedby') ?? '')
                                .split(' ')
                                .filter(Boolean),
                            id,
                        ]),
                    ].join(' '),
                );
                cleanups.push(() => {
                    const description = (
                        control.getAttribute('aria-describedby') ?? ''
                    )
                        .split(' ')
                        .filter((value) => value !== id && value)
                        .join(' ');

                    if (description) {
                        control.setAttribute('aria-describedby', description);
                    } else {
                        control.removeAttribute('aria-describedby');
                    }

                    if (originalInvalid !== null) {
                        control.setAttribute('aria-invalid', originalInvalid);
                    } else {
                        control.removeAttribute('aria-invalid');
                    }
                });
                fields.push({
                    target: group,
                    id,
                    messages: issue.messages,
                    field: issue.field,
                });
            }

            setInlineFields({ feedback, fields });
        });

        return () => {
            cancelAnimationFrame(frame);
            cleanups.forEach((cleanup) => cleanup());
        };
    }, [feedback, scopeRef, inlineId]);

    if (!feedback) {
        return null;
    }

    function focusField(field: string) {
        if (onFocusField) {
            onFocusField(field);

            return;
        }

        const scope = scopeRef?.current;

        if (scope) {
            focusFeedbackField(scope, field);
        }
    }

    return (
        <>
            <div
                ref={summaryRef}
                tabIndex={-1}
                data-slot="form-error-summary"
                className="flex max-h-[min(16rem,35dvh)] w-full flex-col gap-2 overflow-y-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                {entries.map((entry) => (
                    <FormErrorNotice
                        key={formFeedbackKey(entry)}
                        feedback={entry}
                        onFocusField={
                            scopeRef || onFocusField ? focusField : undefined
                        }
                    />
                ))}
            </div>
            {inlineFields?.feedback === feedback &&
                inlineFields.fields.map((field) =>
                    createPortal(
                        <FieldError
                            id={field.id}
                            data-sdk-inline-error=""
                            errors={field.messages.map((message) => ({
                                message,
                            }))}
                        />,
                        field.target,
                        field.field,
                    ),
                )}
        </>
    );
}

function FormErrorNotice({
    feedback,
    onFocusField,
}: {
    feedback: FormFeedback;
    onFocusField?: (field: string) => void;
}) {
    const bodyId = React.useId();
    const [display, setDisplay] = React.useState<{
        feedback: FormFeedback;
        mode: 'expanded' | 'collapsed' | 'dismissed';
    } | null>(null);
    const mode = display?.feedback === feedback ? display.mode : 'expanded';
    const [copyResult, setCopyResult] = React.useState<{
        feedback: FormFeedback;
        status: 'copied' | 'manual';
    } | null>(null);
    async function copyDetails(current: FormFeedback) {
        if (!current.details) {
            return;
        }

        try {
            await navigator.clipboard.writeText(current.details);
            setCopyResult({ feedback: current, status: 'copied' });
        } catch {
            setCopyResult({ feedback: current, status: 'manual' });
        }
    }

    const copied = copyResult?.feedback === feedback ? copyResult.status : null;

    if (mode === 'dismissed') {
        return (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-muted-foreground"
                onClick={() => setDisplay({ feedback, mode: 'expanded' })}
            >
                Tampilkan pesan: {feedback.title}
            </Button>
        );
    }

    return (
        <Alert variant="destructive" data-slot="form-error-notice">
            <CircleAlert aria-hidden="true" />
            <AlertTitle className="line-clamp-none flex items-start gap-2">
                <span className="min-w-0 flex-1">{feedback.title}</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                        mode === 'expanded'
                            ? 'Ringkas pesan'
                            : 'Tampilkan rincian pesan'
                    }
                    title={
                        mode === 'expanded'
                            ? 'Ringkas pesan'
                            : 'Tampilkan rincian pesan'
                    }
                    aria-expanded={mode === 'expanded'}
                    aria-controls={bodyId}
                    onClick={() =>
                        setDisplay({
                            feedback,
                            mode:
                                mode === 'expanded' ? 'collapsed' : 'expanded',
                        })
                    }
                >
                    {mode === 'expanded' ? (
                        <ChevronUp aria-hidden="true" />
                    ) : (
                        <ChevronDown aria-hidden="true" />
                    )}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Sembunyikan pesan"
                    title="Sembunyikan pesan"
                    onClick={() => setDisplay({ feedback, mode: 'dismissed' })}
                >
                    <X aria-hidden="true" />
                </Button>
            </AlertTitle>
            <AlertDescription
                id={bodyId}
                className={mode !== 'expanded' ? 'hidden' : undefined}
            >
                <p>{feedback.message}</p>
                {!!feedback.issues?.length && (
                    <ul className="w-full divide-y">
                        {feedback.issues.map((issue, index) => (
                            <li
                                key={`${issue.field}-${index}`}
                                className="py-1"
                            >
                                {onFocusField ? (
                                    <button
                                        type="button"
                                        className="text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                                        onClick={() =>
                                            onFocusField(issue.field)
                                        }
                                    >
                                        {issue.message}
                                    </button>
                                ) : (
                                    <span>{issue.message}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {(feedback.actions?.length || feedback.details) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {feedback.actions?.map((action) => (
                            <Button
                                key={action.label}
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={action.onClick}
                            >
                                {action.label}
                            </Button>
                        ))}
                        {feedback.details && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void copyDetails(feedback)}
                            >
                                Salin detail bantuan
                            </Button>
                        )}
                    </div>
                )}
                {copied === 'copied' && (
                    <p role="status">Rincian sudah disalin.</p>
                )}
                {copied === 'manual' && (
                    <div className="flex w-full flex-col gap-2">
                        <p role="status">
                            Belum dapat disalin otomatis. Pilih teks berikut dan
                            salin secara manual.
                        </p>
                        <Textarea
                            label="Detail bantuan untuk disalin"
                            readOnly
                            value={feedback.details}
                            rows={4}
                        />
                    </div>
                )}
            </AlertDescription>
        </Alert>
    );
}
