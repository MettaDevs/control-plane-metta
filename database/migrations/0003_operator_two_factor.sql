-- 2FA operator dengan TOTP, opsional seperti di konsol CoreERP (keputusan pemilik produk, 9 November 2026). Di CoreERP
-- kolom ini milik users dan dikelola Fortify di Core; di sini milik operators dan dikelola konsol sendiri.
--
-- two_factor_secret dan two_factor_recovery_codes dienkripsi AES-256-GCM dengan kunci turunan APP_KEY. Secret yang terisi
-- tanpa two_factor_confirmed_at adalah pendaftaran yang belum dikonfirmasi dan belum diminta saat login.
-- two_factor_last_step adalah langkah 30 detik dari kode TOTP terakhir yang diterima, supaya kode yang sama tidak bisa
-- dipakai dua kali.

ALTER TABLE public.operators
    ADD COLUMN two_factor_secret text,
    ADD COLUMN two_factor_recovery_codes text,
    ADD COLUMN two_factor_confirmed_at timestamp(0) without time zone,
    ADD COLUMN two_factor_last_step bigint;
