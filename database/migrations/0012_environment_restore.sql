-- Operasi restore: lingkungan yang dihapus lunak dipulihkan selama masa tenggangnya belum habis. Worker menyalakan lagi
-- alamatnya di runtime, lalu control plane melepas hapus lunaknya saat penutupan sukses diterima.

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    ADD CONSTRAINT environment_operations_jenis_dikenal
        CHECK (operation IN ('provision', 'migrate', 'convert', 'expire', 'restore'));
