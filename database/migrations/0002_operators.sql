-- Operator dipisah dari pengguna customer (keputusan pemilik produk, 9 November 2026). Di CoreERP operator adalah baris
-- users yang punya provider_access berperan provider_admin, jadi login konsol membaca tabel pengguna klinik. Di sini
-- operator punya tabelnya sendiri, dan users tetap untuk identitas pengguna customer.
--
-- provider_access belum dicabut: ia satu-satunya penanda operator di data CoreERP, dan dipakai saat data operator
-- dipindah ke tabel ini.

CREATE TABLE public.operators (
    id uuid PRIMARY KEY,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    -- Sesi konsol berupa cookie bertanda tangan tanpa tabel sesi. Sesi yang dibuat sebelum waktu ini ditolak, jadi
    -- logout dan logout dari penyedia SSO cukup mengisi kolom ini.
    sessions_valid_after timestamp(3) with time zone,
    created_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    deleted_at timestamp(0) without time zone
);

CREATE UNIQUE INDEX operators_email_unique ON public.operators USING btree (lower((email)::text))
    WHERE (deleted_at IS NULL);

-- Jejak audit menunjuk operator, bukan pengguna customer. Isinya kosong di database baru; saat data CoreERP dipindah,
-- operator mendapat id yang sama dengan baris users-nya, jadi kolom ini tidak perlu dipetakan ulang.
ALTER TABLE public.operator_audit_events DROP CONSTRAINT operator_audit_events_user_id_foreign;
ALTER TABLE public.operator_audit_events RENAME COLUMN user_id TO operator_id;
ALTER INDEX public.operator_audit_events_user_id_occurred_at_index
    RENAME TO operator_audit_events_operator_id_occurred_at_index;
ALTER TABLE public.operator_audit_events
    ADD CONSTRAINT operator_audit_events_operator_id_foreign FOREIGN KEY (operator_id) REFERENCES public.operators(id);

-- Penghitung percobaan, misalnya login yang gagal. key adalah sha256 dari kunci aslinya, supaya email dan alamat IP
-- tidak tersimpan apa adanya. Baris lama tidak dihapus; hitungannya mulai lagi dari satu setelah reset_at lewat.
CREATE TABLE public.rate_limits (
    key character(64) PRIMARY KEY,
    hits integer NOT NULL,
    reset_at timestamp(3) with time zone NOT NULL
);
