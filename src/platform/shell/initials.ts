// Inisial nama untuk avatar di header konsol dan portal.
export function initials(fullName: string): string {
    const names = fullName.trim().split(/\s+/u).filter(Boolean);
    const first = names[0];
    const last = names.at(-1);
    if (!first || !last) return '';
    const initial = (name: string) => Array.from(name)[0] ?? '';
    return (
        names.length === 1 ? initial(first) : initial(first) + initial(last)
    ).toUpperCase();
}
