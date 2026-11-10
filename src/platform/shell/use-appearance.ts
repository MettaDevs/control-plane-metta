import { useSyncExternalStore } from 'react';

// Tema terang/gelap, dipindah dari use-appearance CoreERP. Pilihannya disimpan di localStorage `appearance`, yang juga
// dibaca skrip pendek di dokumen layar (src/platform/http/spa.ts) sebelum stylesheet dipakai. CoreERP menyimpannya
// juga di cookie untuk dirender server; di sini dokumennya sama untuk semua orang, jadi cookie itu tidak diperlukan.

type ResolvedAppearance = 'light' | 'dark';
type Appearance = ResolvedAppearance | 'system';

const listeners = new Set<() => void>();
let currentAppearance: Appearance = 'system';
let systemAppearance: ResolvedAppearance = 'light';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

function storedAppearance(): Appearance {
    try {
        const stored = localStorage.getItem('appearance');
        return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
        return 'system';
    }
}

function applyTheme(appearance: Appearance): void {
    const isDark =
        appearance === 'dark' ||
        (appearance === 'system' && systemAppearance === 'dark');
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

const notify = () => listeners.forEach((listener) => listener());

function systemChanged(): void {
    systemAppearance = query().matches ? 'dark' : 'light';
    applyTheme(currentAppearance);
    notify();
}

export function initializeTheme(): void {
    currentAppearance = storedAppearance();
    systemChanged();
    query().addEventListener('change', systemChanged);
}

const subscribe = (callback: () => void) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
};

export function useAppearance() {
    const appearance = useSyncExternalStore(subscribe, () => currentAppearance);
    const system = useSyncExternalStore(subscribe, () => systemAppearance);
    const resolvedAppearance = appearance === 'system' ? system : appearance;

    const updateAppearance = (mode: Appearance): void => {
        currentAppearance = mode;
        try {
            localStorage.setItem('appearance', mode);
        } catch {
            // Peramban yang menolak localStorage tetap berganti tema untuk sesi ini.
        }
        applyTheme(mode);
        notify();
    };

    return { appearance, resolvedAppearance, updateAppearance } as const;
}
