-- Laporan host runtime: worker melapor rilis image yang ia jalankan, dan untuk setiap lingkungan yang alamatnya
-- tercatat di runtime-nya: migration terakhir per pemilik, ukuran database, dan sehat atau tidak. Control plane
-- menyimpan laporan terakhir saja; riwayat perubahan lingkungan ada di environment_operations.
-- Nomor 0014 dilewati: migration copy bernomor itu sudah ditarik (#29).

ALTER TABLE public.runtime_hosts
    ADD COLUMN reported_release character varying(80),
    ADD COLUMN reported_at timestamp(0) without time zone;

ALTER TABLE public.environments
    ADD COLUMN reported_migrations jsonb,
    ADD COLUMN reported_size_bytes bigint,
    ADD COLUMN reported_healthy boolean,
    ADD COLUMN reported_problem text,
    ADD COLUMN reported_at timestamp(0) without time zone;
