-- Operasi expire: demo yang tanggal berakhirnya lewat diantrekan saat host pemegangnya meminta pekerjaan. Worker
-- menonaktifkan alamatnya di runtime, lalu control plane menghapus lunak lingkungannya.

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    ADD CONSTRAINT environment_operations_jenis_dikenal
        CHECK (operation IN ('provision', 'migrate', 'convert', 'expire'));
