import * as React from 'react';

type RecordEditActivation = {
    canActivate: boolean;
    activate: (target: HTMLElement, focusField?: boolean) => boolean;
};

const RecordEditContext = React.createContext<RecordEditActivation | null>(
    null,
);

/**
 * Mode edit tetap dikendalikan halaman. SDK hanya meminta edit lewat field baca saja
 * atau fasttab; tidak menyimpan data, membuka hak baru, atau menangkap klik portal.
 */
function RecordEditBoundary({
    editing,
    canEdit,
    disabled = false,
    onEdit,
    children,
    ...props
}: React.ComponentPropsWithoutRef<'div'> & {
    editing: boolean;
    canEdit: boolean;
    disabled?: boolean;
    onEdit: () => void;
}) {
    const boundaryRef = React.useRef<HTMLDivElement>(null);
    const focusFieldRef = React.useRef<HTMLElement | null>(null);
    const canActivate = canEdit && !editing && !disabled;
    const activate = (target: HTMLElement, focusField = false) => {
        if (!canActivate || !boundaryRef.current?.contains(target)) {
            return false;
        }

        focusFieldRef.current = focusField
            ? (target.closest<HTMLElement>(
                  '[data-record-edit-control], [data-slot="field"]',
              ) ?? target.parentElement)
            : null;
        onEdit();

        return true;
    };

    React.useLayoutEffect(() => {
        const field = focusFieldRef.current;
        focusFieldRef.current = null;

        if (
            !editing ||
            !field?.isConnected ||
            !boundaryRef.current?.contains(field)
        ) {
            return;
        }

        // Field yang tadinya Input baca saja dapat berubah menjadi combobox saat edit.
        field
            .querySelector<HTMLElement>(
                '[role="combobox"]:not([disabled]), input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled]), button:not([disabled])',
            )
            ?.focus({ preventScroll: true });
    }, [editing]);

    return (
        <RecordEditContext.Provider value={{ canActivate, activate }}>
            <div {...props} ref={boundaryRef} data-slot="record-edit-boundary">
                {children}
            </div>
        </RecordEditContext.Provider>
    );
}

function useRecordEditActivation() {
    return React.useContext(RecordEditContext);
}

/** Kontrol tanpa readOnly memakai aktivasi terpisah agar klik pertama tidak mengubah nilai. */
function RecordEditControl({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    const activation = useRecordEditActivation();
    const active = activation?.canActivate ?? false;
    const triggerRef = React.useRef<HTMLButtonElement>(null);

    return (
        <div
            data-record-edit-control=""
            className="relative min-w-0"
            onFocusCapture={
                active
                    ? (event) => {
                          if (!triggerRef.current?.contains(event.target)) {
                              triggerRef.current?.focus({
                                  preventScroll: true,
                              });
                          }
                      }
                    : undefined
            }
            onClickCapture={
                active
                    ? (event) => {
                          if (event.target !== triggerRef.current) {
                              event.preventDefault();
                              event.stopPropagation();
                              activation?.activate(event.currentTarget, true);
                          }
                      }
                    : undefined
            }
        >
            <div className={active ? 'pointer-events-none' : undefined}>
                {children}
            </div>
            {active && (
                <button
                    ref={triggerRef}
                    type="button"
                    aria-label={`Ubah ${label.toLocaleLowerCase()}`}
                    className="absolute inset-0 z-10 cursor-text rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        activation?.activate(event.currentTarget, true);
                    }}
                />
            )}
        </div>
    );
}

export { RecordEditBoundary, RecordEditControl, useRecordEditActivation };
