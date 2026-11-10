-- Operasi purge: database lingkungan bukan produksi yang dihapus lunak dibuang setelah masa tenggangnya habis.
-- Diantrekan saat host pemegangnya meminta pekerjaan; penutupan sukses mencatat purged_at, dan baris lingkungan beserta
-- riwayatnya tetap ada.

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    ADD CONSTRAINT environment_operations_jenis_dikenal
        CHECK (operation IN ('provision', 'migrate', 'convert', 'expire', 'restore', 'purge'));
