import * as React from 'react';

import { cn } from '../utils';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from './accordion';
import { useRecordEditActivation } from './record-edit-boundary';

/**
 * A titled section that collapses, and keeps a summary of its contents readable while
 * collapsed. The summary is the reason this exists: `Accordion` already gives the chevron,
 * the animation and multiple-open behaviour, but it has no place to show what is inside a
 * section the user has closed. Everything else is delegated, not reimplemented.
 *
 * Sections are independent — opening one never closes another.
 */
const OpenSectionsContext = React.createContext<readonly string[]>([]);

function CollapsibleSectionGroup({
    value,
    defaultValue,
    onValueChange,
    className,
    children,
}: {
    /** Open section values. Pass this to control the group; omit it to let it manage itself. */
    value?: string[];
    defaultValue?: string[];
    onValueChange?: (value: string[]) => void;
    className?: string;
    children: React.ReactNode;
}) {
    const [uncontrolled, setUncontrolled] = React.useState<string[]>(
        defaultValue ?? [],
    );
    const open = value ?? uncontrolled;

    return (
        <OpenSectionsContext.Provider value={open}>
            <Accordion
                type="multiple"
                value={open}
                onValueChange={(next: string[]) => {
                    if (value === undefined) {
                        setUncontrolled(next);
                    }

                    onValueChange?.(next);
                }}
                data-slot="collapsible-section-group"
                className={cn('flex w-full min-w-0 flex-col gap-2', className)}
            >
                {children}
            </Accordion>
        </OpenSectionsContext.Provider>
    );
}

function CollapsibleSection({
    value,
    title,
    summary,
    keepMounted = false,
    className,
    children,
}: {
    /** Identifier of this section, unique within its group. */
    value: string;
    title: string;
    /**
     * Key values shown beside the title while the section is collapsed. It is removed from
     * the tree once the section opens rather than hidden with CSS, so a screen reader never
     * reads the same value twice.
     */
    summary?: React.ReactNode;
    /** Preserve form drafts after the section has first been opened. */
    keepMounted?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    const isOpen = React.useContext(OpenSectionsContext).includes(value);
    const [hasOpened, setHasOpened] = React.useState(isOpen);

    if (isOpen && !hasOpened) {
        setHasOpened(true);
    }

    const preserveContent = keepMounted && hasOpened;
    const activation = useRecordEditActivation();

    return (
        <AccordionItem
            value={value}
            data-slot="collapsible-section"
            className={cn('w-full min-w-0 border-b last:border-b', className)}
        >
            <AccordionTrigger
                className="min-h-8 w-full min-w-0 items-center rounded-none px-3 py-1 hover:no-underline"
                onClick={(event) => {
                    if (!event.defaultPrevented) {
                        activation?.activate(event.currentTarget);
                    }
                }}
            >
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="max-w-full min-w-0 text-lg leading-6 font-semibold [overflow-wrap:anywhere]">
                        {title}
                    </span>
                    {!isOpen && summary != null && (
                        <span className="min-w-0 flex-1 basis-40 truncate text-sm font-normal text-muted-foreground">
                            {summary}
                        </span>
                    )}
                </span>
            </AccordionTrigger>
            {/*
        `border-t` draws the line between the title row and its content — the trigger row
        has no border of its own, so this is the only seam that can carry it.
        `pt-3` (not `pt-0`) exists because `Input`'s floating label straddles the top edge
        of the control (`top-0 -translate-y-1/2`, so roughly half its own height sits above
        that edge by design). `AccordionContent`'s wrapper is `overflow-hidden` — required
        for the open/close height animation — so with no top clearance the label's overshoot
        was clipped for any field placed first inside a section. This padding is what gives
        it room; it is not decorative spacing.
      */}
            <AccordionContent
                className="min-w-0 px-3 pt-3 pb-3"
                forceMount={preserveContent ? true : undefined}
                hidden={preserveContent && !isOpen ? true : undefined}
            >
                {children}
            </AccordionContent>
        </AccordionItem>
    );
}

export { CollapsibleSectionGroup, CollapsibleSection };
