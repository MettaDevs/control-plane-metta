import * as React from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from './alert-dialog';

type ConfirmationOptions = {
    title: string;
    description: string;
    confirmLabel?: string;
    destructive?: boolean;
};

export function useConfirmation() {
    const [options, setOptions] = React.useState<ConfirmationOptions | null>(
        null,
    );
    const resolver = React.useRef<((confirmed: boolean) => void) | null>(null);

    React.useEffect(
        () => () => {
            resolver.current?.(false);
            resolver.current = null;
        },
        [],
    );

    function finish(confirmed: boolean) {
        const resolve = resolver.current;
        resolver.current = null;
        setOptions(null);
        resolve?.(confirmed);
    }

    function confirm(next: ConfirmationOptions): Promise<boolean> {
        if (resolver.current) {
            return Promise.resolve(false);
        }

        return new Promise((resolve) => {
            resolver.current = resolve;
            setOptions(next);
        });
    }

    return {
        confirm,
        confirmation: (
            <AlertDialog
                open={options !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        finish(false);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{options?.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {options?.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => finish(false)}>
                            Batal
                        </AlertDialogCancel>
                        <AlertDialogAction
                            variant={
                                options?.destructive ? 'destructive' : 'default'
                            }
                            onClick={() => finish(true)}
                        >
                            {options?.confirmLabel ?? 'Lanjutkan'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        ),
    };
}
