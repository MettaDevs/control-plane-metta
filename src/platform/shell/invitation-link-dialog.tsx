import { Button } from '@control-plane-metta/ui/button';
import {
    Dialog,
    DialogAction,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@control-plane-metta/ui/dialog';
import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

// Email gagal terkirim: tautan tetap berlaku, jadi operator bisa mengirimkannya sendiri. Tautan hanya tampil di sini.
export function InvitationLinkDialog({
    sent,
    onClose,
}: {
    sent: { accept_url: string; email_failure: string | null };
    onClose: () => void;
}): ReactNode {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent size="compact">
                <DialogHeader>
                    <DialogTitle>Email undangan belum terkirim</DialogTitle>
                    <DialogDescription>
                        {sent.email_failure} Undangannya tetap tersimpan. Kirim
                        ulang nanti, atau kirim tautan ini sendiri lewat jalur
                        pribadi. Tautan ini tidak akan ditampilkan lagi.
                    </DialogDescription>
                </DialogHeader>
                <DialogBody className="flex flex-col gap-3">
                    <code className="rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all select-all">
                        {sent.accept_url}
                    </code>
                    <div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(
                                        sent.accept_url,
                                    );
                                    toast.success('Tautan disalin.');
                                } catch {
                                    toast.error(
                                        'Tautan belum tersalin. Pilih teksnya lalu salin manual.',
                                    );
                                }
                            }}
                        >
                            <Copy />
                            Salin tautan
                        </Button>
                    </div>
                </DialogBody>
                <DialogFooter>
                    <DialogAction type="button" onClick={onClose}>
                        Tutup
                    </DialogAction>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
