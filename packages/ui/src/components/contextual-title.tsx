import type { ReactNode } from 'react';
import { cn } from '../utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from './tooltip';

/** Judul menjadi target bantuan yang sama untuk pointer dan keyboard. */
export function ContextualTitle({
    children,
    hint,
    className,
}: {
    children: ReactNode;
    hint: ReactNode;
    className?: string;
}) {
    return (
        <TooltipProvider delayDuration={1000}>
            <Tooltip clickToPin>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            'cursor-help text-left text-inherit underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring data-[state=delayed-open]:underline data-[state=instant-open]:underline',
                            className,
                        )}
                    >
                        {children}
                    </button>
                </TooltipTrigger>
                <TooltipContent
                    side="bottom"
                    align="start"
                    className="max-w-80"
                >
                    {hint}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
