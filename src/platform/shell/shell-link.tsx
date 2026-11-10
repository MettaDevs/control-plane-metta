import { useNavigate } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

// Tautan menu yang tujuannya teks biasa dari `navigation.ts`, bukan path bertipe `Link` TanStack Router. Klik biasa berpindah layar tanpa memuat ulang dokumen; klik tengah, Ctrl, atau Shift tetap membuka tab baru.
export function ShellLink({
    href,
    onClick,
    ...props
}: ComponentProps<'a'> & { href: string }) {
    const navigate = useNavigate();

    return (
        <a
            href={href}
            {...props}
            onClick={(event) => {
                onClick?.(event);
                if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                )
                    return;
                event.preventDefault();
                void navigate({ href });
            }}
        />
    );
}
