import { Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '../utils';

type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root> & {
    clickToPin?: boolean;
};

type TooltipPinContextValue = {
    togglePinned: () => void;
};

const TooltipPinContext = React.createContext<TooltipPinContextValue | null>(
    null,
);

function TooltipProvider({
    delayDuration = 1000,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
    return (
        <TooltipPrimitive.Provider
            data-slot="tooltip-provider"
            delayDuration={delayDuration}
            {...props}
        />
    );
}

function Tooltip({
    clickToPin = false,
    open: openProp,
    defaultOpen,
    onOpenChange,
    ...props
}: TooltipProps) {
    const [pinned, setPinned] = React.useState(false);
    const [hoverOpen, setHoverOpen] = React.useState(defaultOpen ?? false);
    const togglePinned = React.useCallback(() => {
        setPinned((current) => !current);
    }, []);
    const handleOpenChange = React.useCallback(
        (nextOpen: boolean) => {
            setHoverOpen(nextOpen);
            onOpenChange?.(nextOpen);
        },
        [onOpenChange],
    );
    const open = clickToPin ? (openProp ?? (pinned || hoverOpen)) : openProp;

    return (
        <TooltipPinContext.Provider
            value={clickToPin ? { togglePinned } : null}
        >
            <TooltipPrimitive.Root
                data-slot="tooltip"
                {...props}
                open={open}
                defaultOpen={defaultOpen}
                onOpenChange={clickToPin ? handleOpenChange : onOpenChange}
            />
        </TooltipPinContext.Provider>
    );
}

function TooltipTrigger({
    onClick,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
    const pinContext = React.useContext(TooltipPinContext);

    return (
        <TooltipPrimitive.Trigger
            data-slot="tooltip-trigger"
            {...props}
            onClick={(event) => {
                onClick?.(event);

                if (!event.defaultPrevented) {
                    pinContext?.togglePinned();
                }
            }}
        />
    );
}

function TooltipContent({
    className,
    sideOffset = 0,
    children,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                data-slot="tooltip-content"
                sideOffset={sideOffset}
                className={cn(
                    'z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-balance text-slate-900 shadow-lg fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
                    className,
                )}
                {...props}
            >
                {children}
                <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] border border-slate-200 bg-white fill-white shadow-sm" />
            </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
    );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
