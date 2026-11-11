-- Sesi portal klien, seperti sesi konsol, tidak punya tabel: cookie-nya memuat identitas SSO dan waktu login. Logout dan
-- back-channel logout dari penyedia SSO mengakhiri semua sesi identitas itu, termasuk di perangkat lain, dengan mengisi
-- kolom ini pada setiap akses hidupnya. Sesi yang terbit sebelum waktu ini ditolak.
ALTER TABLE public.client_portal_users
    ADD COLUMN sessions_valid_after timestamp(3) with time zone;
