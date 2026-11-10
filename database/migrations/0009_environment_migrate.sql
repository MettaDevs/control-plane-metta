-- Operasi migrate: worker menjalankan migration Core operations-metta di database lingkungan yang sudah disiapkan,
-- sampai skemanya sama dengan kode di host runtime-nya. Jenis operasi lain ditambahkan migration yang datang bersama
-- kodenya.

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    ADD CONSTRAINT environment_operations_jenis_dikenal CHECK (operation IN ('provision', 'migrate'));
