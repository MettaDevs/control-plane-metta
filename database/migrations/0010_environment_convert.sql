-- Operasi convert: demo menjadi produksi di tempat, beserta datanya. Worker memindah alamatnya di runtime, dan control
-- plane mengubah jenis lingkungannya saat worker menutup operasi itu sukses.

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    ADD CONSTRAINT environment_operations_jenis_dikenal CHECK (operation IN ('provision', 'migrate', 'convert'));
