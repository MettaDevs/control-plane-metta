-- Pengaturan penempatan per host runtime: apakah host menerima lingkungan baru, berapa lingkungan hidup paling banyak
-- (kosong berarti tanpa batas), apakah host khusus (hanya dipakai bila operator memilihnya langsung, tidak ikut
-- penempatan otomatis), dan ring untuk pembaruan bertahap.

ALTER TABLE public.runtime_hosts
    ADD COLUMN accepts_new boolean DEFAULT true NOT NULL,
    ADD COLUMN capacity integer,
    ADD COLUMN dedicated boolean DEFAULT false NOT NULL,
    ADD COLUMN ring character varying(20) DEFAULT 'general' NOT NULL,
    ADD CONSTRAINT runtime_hosts_kapasitas_positif CHECK (capacity IS NULL OR capacity > 0),
    ADD CONSTRAINT runtime_hosts_ring_dikenal CHECK (ring IN ('canary', 'early', 'general'));
