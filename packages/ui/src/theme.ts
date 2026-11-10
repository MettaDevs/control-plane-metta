export type CoreErpTheme = {
    appearance: 'light' | 'dark';
    font: 'poppins' | 'geist';
};

export function applyCoreErpTheme(theme?: CoreErpTheme): void {
    if (typeof document === 'undefined') {
        return;
    }

    const appearance = theme?.appearance ?? 'light';
    const font = theme?.font ?? 'poppins';
    const root = document.documentElement;

    root.classList.toggle('dark', appearance === 'dark');
    root.dataset.font = font;
    root.style.colorScheme = appearance;
}
