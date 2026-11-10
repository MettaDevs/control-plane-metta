import * as React from 'react';

import { TableScrollContext } from '../table-scroll-context';
import { cn } from '../utils';

type ListPageLayoutProps = React.ComponentProps<'section'> & {
    header?: React.ReactNode;
    filters?: React.ReactNode;
    /** Panel di samping isi tidak melepas tabel ketika dibuka atau ditutup. */
    filterPanel?: React.ReactNode;
    filterSide?: 'left' | 'right';
    footer?: React.ReactNode;
};

/**
 * Daftar mengikuti tinggi ruang Shell. Header, filter, dan footer tetap terlihat;
 * DataTable pada bagian isi mengambil sisa ruang dan memiliki scroll-nya sendiri.
 * Dialog/Sheet ditempatkan sebagai saudara layout supaya tabel kecil tetap inline.
 */
function ListPageLayout({
    header,
    filters,
    filterPanel,
    filterSide = 'left',
    footer,
    children,
    className,
    ...props
}: ListPageLayoutProps) {
    return (
        <section
            {...props}
            data-layout="full-height"
            className={cn(
                'flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
                className,
            )}
        >
            {header != null && <div className="shrink-0">{header}</div>}
            {filters != null && <div className="shrink-0 pt-3">{filters}</div>}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
                {filterSide === 'left' ? filterPanel : null}
                <div
                    data-slot="list-page-content"
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                    <TableScrollContext.Provider value="viewport">
                        {children}
                    </TableScrollContext.Provider>
                </div>
                {filterSide === 'right' ? filterPanel : null}
            </div>
            {footer != null && <div className="shrink-0">{footer}</div>}
        </section>
    );
}

export { ListPageLayout };
export type { ListPageLayoutProps };
