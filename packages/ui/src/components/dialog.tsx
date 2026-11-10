import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';
import { DocumentLineCellContext } from '../document-line-context';

import { cn } from '../utils';
import { Button } from './button';

/**
 * Dialog seukuran halaman, mengikuti pola Dynamics 365.
 *
 * Tiga aturan yang dijaga komponen ini:
 *
 * 1. Ukurannya halaman, bukan kotak kecil. Form panjang punya tempat, dan
 *    isinya menggulir di dalam badan dialog — header dan footer tetap diam.
 * 2. Footer memakai tombol standar. Tepat satu `DialogAction` sebagai aksi
 *    utama; sisanya netral. Jangan mewarnai tombol satu per satu.
 * 3. Bertumpuk. Saat dialog kedua terbuka, lapisan di bawahnya mundur ke kiri,
 *    mengecil, dan meredup — supaya pengguna paham ia turun satu lapis, bukan
 *    berpindah layar. Efeknya sengaja dibatasi pada `transform` dan `opacity`
 *    saja; blur pada permukaan seukuran halaman membuat transisi tersendat.
 *
 * Susunan yang diharapkan:
 *
 * ```tsx
 * <DialogContent size="wide">
 *   <DialogHeader>
 *     <DialogTitle>Judul</DialogTitle>
 *     <DialogDescription>Penjelasan singkat.</DialogDescription>
 *   </DialogHeader>
 *   <DialogToolbar>...aksi kontekstual...</DialogToolbar>
 *   <DialogBody>...isi yang menggulir...</DialogBody>
 *   <DialogFooter>
 *     <DialogAction type="submit">Simpan</DialogAction>
 *     <DialogCancel />
 *   </DialogFooter>
 * </DialogContent>
 * ```
 */

// Tumpukan dilacak di tingkat modul supaya tiap dialog tahu posisinya tanpa
// provider yang harus dipasang di root aplikasi.
let stack: symbol[] = [];
const listeners = new Set<() => void>();

function mutate(next: symbol[]) {
    stack = next;
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

function useStackPosition() {
    // Identitas dialog ini lahir sekali lewat penginisialisasi `useState`, bukan lewat ref
    // yang diisi malas. Nilai yang ikut menentukan hasil render harus boleh dibaca saat
    // render, dan `current` sebuah ref tidak boleh — membacanya di sana membuat React tidak
    // dapat menjamin komponen ini ikut diperbarui saat nilainya berubah.
    const [self] = React.useState(() => Symbol('dialog'));
    // Snapshot berupa posisi dialog ini sendiri, bukan nomor versi tumpukan.
    // Dengan nomor versi, setiap buka/tutup dialog mana pun akan merender ulang
    // seluruh dialog yang sedang terpasang — kerja React itu jatuh tepat pada
    // frame ketika dialog baru sedang beranimasi masuk.
    const getSnapshot = React.useCallback(() => {
        const index = stack.indexOf(self);

        return index !== -1 && index < stack.length - 1;
    }, [self]);

    React.useEffect(() => {
        mutate([...stack, self]);

        return () => {
            mutate(stack.filter((entry) => entry !== self));
        };
    }, [self]);

    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const sizes = {
    /** Menutup hampir seluruh viewport. Untuk form panjang, tabel, matriks. */
    full: 'inset-2 sm:inset-6',
    /** Terpusat dengan lebar terbatas dan tinggi penuh. Bawaan. */
    wide: 'inset-x-2 inset-y-4 sm:inset-y-10 sm:left-1/2 sm:w-full sm:max-w-4xl sm:-translate-x-1/2',
    /** Menempel di kanan seperti panel Business Central. Untuk detail pendamping. */
    panel: 'inset-y-0 right-0 w-full sm:max-w-2xl',
    /** Kotak kecil setinggi isinya. Untuk konfirmasi dan form satu-dua field. */
    compact:
        'top-1/2 left-1/2 w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
} as const;

type DialogSize = keyof typeof sizes;

function Dialog({
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
    return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
    className,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
    return (
        <DialogPrimitive.Overlay
            data-slot="dialog-overlay"
            className={cn(
                // Tanpa `backdrop-filter`. Ia memaksa browser menyalin lalu mengaburkan
                // seluruh isi di belakang overlay pada setiap frame, dan dialog di sini
                // seukuran halaman. Peredupan sudah cukup dikerjakan `bg-black/40`.
                'fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
                className,
            )}
            {...props}
        />
    );
}

function DialogContent({
    children,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
    size?: DialogSize;
    showCloseButton?: boolean;
}) {
    // Permukaan sengaja dipisah ke komponen sendiri di dalam Portal. Portal hanya
    // memasang anaknya saat dialog terbuka, sehingga pendaftaran tumpukan tidak
    // ikut jalan untuk dialog yang masih tertutup — kalau ikut, dialog tertutup
    // akan membuat dialog lain salah dianggap berada di lapisan bawah.
    return (
        <DialogPortal>
            <DialogOverlay />
            <DialogSurface {...props}>{children}</DialogSurface>
        </DialogPortal>
    );
}

function DialogSurface({
    className,
    children,
    size = 'wide',
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
    size?: DialogSize;
    showCloseButton?: boolean;
}) {
    const isBehind = useStackPosition();

    return (
        <>
            <DialogPrimitive.Content
                data-slot="dialog-content"
                data-behind={isBehind ? '' : undefined}
                className={cn(
                    'fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl outline-none',
                    // Hanya `transform` dan `opacity` yang dianimasikan; keduanya dapat
                    // dikerjakan compositor tanpa raster ulang. `filter` tidak boleh ikut
                    // — lihat catatan pada kelas data-[behind] di bawah.
                    'transition-[transform,opacity] duration-200 ease-out',
                    'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
                    // Lapisan yang tertimpa mundur ke kiri, meredup, dan berhenti
                    // menerima klik supaya fokus benar-benar pindah ke lapisan teratas.
                    // Tanpa blur: `filter: blur()` memaksa seluruh subtree dialog
                    // dirasterkan ulang, dan dialog ini seukuran halaman berisi tabel
                    // serta pohon organisasi. Kedalaman sudah terbaca dari mundur,
                    // mengecil, dan meredup.
                    'data-[behind]:pointer-events-none data-[behind]:opacity-60',
                    size === 'wide'
                        ? 'data-[behind]:sm:-translate-x-[calc(50%+2.5rem)]'
                        : 'data-[behind]:-translate-x-10',
                    'data-[behind]:scale-[0.97]',
                    sizes[size],
                    size === 'panel' && 'rounded-none border-y-0 border-r-0',
                    className,
                )}
                {...props}
            >
                <DocumentLineCellContext.Provider value={null}>
                    {children}
                </DocumentLineCellContext.Provider>
                {showCloseButton && (
                    <DialogPrimitive.Close
                        data-slot="dialog-close"
                        aria-label="Tutup"
                        className="absolute top-3.5 right-4 rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                        <XIcon className="size-4" />
                    </DialogPrimitive.Close>
                )}
            </DialogPrimitive.Content>
        </>
    );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="dialog-header"
            className={cn(
                'flex shrink-0 flex-col gap-1 border-b px-6 py-4 pr-14',
                className,
            )}
            {...props}
        />
    );
}

function DialogTitle({
    className,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
    return (
        <DialogPrimitive.Title
            data-slot="dialog-title"
            className={cn('text-lg leading-tight font-semibold', className)}
            {...props}
        />
    );
}

/** Teks penjelas tampil langsung di bawah judul, bukan disembunyikan di tooltip. */
function DialogDescription({
    className,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
    return (
        <DialogPrimitive.Description
            data-slot="dialog-description"
            className={cn('text-sm text-muted-foreground', className)}
            {...props}
        />
    );
}

/** Baris aksi kontekstual di bawah header, sejajar Action Pane Dynamics. */
function DialogToolbar({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="dialog-toolbar"
            data-command-bar=""
            className={cn(
                'sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-1 border-b bg-background px-4 py-1',
                className,
            )}
            {...props}
        />
    );
}

/** Satu-satunya bagian yang menggulir. Header, toolbar, dan footer tetap diam. */
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="dialog-body"
            className={cn(
                'min-h-0 flex-1 scroll-pt-3 overflow-auto px-6 py-4',
                className,
            )}
            {...props}
        />
    );
}

/**
 * Seluruh kelompok tombol rata kanan. Urutan anak menentukan tata letak: aksi
 * utama lebih dulu, lalu aksi netral — mengikuti tata letak tombol Fluent.
 */
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="dialog-footer"
            className={cn(
                'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-6 py-3',
                className,
            )}
            {...props}
        />
    );
}

/** Aksi utama. Tepat satu per dialog — jangan mewarnai tombol lain. */
function DialogAction({
    className,
    ...props
}: React.ComponentProps<typeof Button>) {
    return (
        <Button
            data-slot="dialog-action"
            className={cn('min-w-28', className)}
            {...props}
        />
    );
}

/** Penutup dialog bantu; perintah record Batal memakai ActionButton. */
function DialogCancel({
    className,
    children = 'Batal',
    ...props
}: React.ComponentProps<typeof Button>) {
    return (
        <DialogPrimitive.Close asChild>
            <Button
                data-slot="dialog-cancel"
                variant="ghost"
                size="command"
                type="button"
                className={cn('min-w-0', className)}
                {...props}
            >
                {children}
            </Button>
        </DialogPrimitive.Close>
    );
}

export {
    Dialog,
    DialogAction,
    DialogBody,
    DialogCancel,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogToolbar,
    DialogTrigger,
    type DialogSize,
};
