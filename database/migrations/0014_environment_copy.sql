-- Operasi copy: produksi disalin menjadi sandbox baru milik tenant yang sama. Sandbox lahir berstatus copying dan
-- terikat ke host produksinya; worker menyalin, melucuti efek keluar, memigrasi, memeriksa kesehatan, lalu mencatat
-- alamatnya.

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    ADD CONSTRAINT environment_operations_jenis_dikenal
        CHECK (operation IN ('provision', 'migrate', 'convert', 'expire', 'restore', 'purge', 'copy'));
