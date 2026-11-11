-- Demo boleh tanpa tanggal berakhir (keputusan pemilik produk, 11 November 2026). Demo tanpa tanggal tidak pernah
-- diantrekan expire, karena syarat jatuh temponya expires_at <= sekarang.

ALTER TABLE public.environments
    DROP CONSTRAINT environments_demo_berakhir;
