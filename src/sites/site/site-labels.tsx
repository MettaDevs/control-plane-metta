import type { ApiOutput } from '../../platform/shell/index.ts';

type SiteState = ApiOutput<'listSites'>['sites'][number]['state'];
type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

export function siteState(state: SiteState): {
    label: string;
    variant: Variant;
} {
    switch (state) {
        case 'not_enrolled':
            return { label: 'Belum tersambung', variant: 'secondary' };
        case 'active':
            return { label: 'Aktif', variant: 'default' };
        case 'stale':
            return { label: 'Tidak melapor', variant: 'destructive' };
        case 'revoked':
            return { label: 'Dicabut', variant: 'outline' };
        default: {
            const unknown: never = state;
            return { label: unknown, variant: 'outline' };
        }
    }
}

// Waktu dari server berupa UTC; operator membacanya dalam jam lokal peramban.
export function displayTime(value: string | null): string {
    if (!value) return '-';
    return new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}
