-- Kolom aktor di tabel situs menunjuk operator, bukan pengguna customer, sama dengan operator_audit_events di
-- 0002_operators.sql: yang membuat situs, menerbitkan token pendaftaran, dan meminta operasi selalu operator konsol.
-- Kolomnya kosong di database baru; saat data CoreERP dipindah, operator mendapat id yang sama dengan baris users-nya.

ALTER TABLE public.sites DROP CONSTRAINT sites_created_by_foreign;
ALTER TABLE public.sites
    ADD CONSTRAINT sites_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.operators(id);

ALTER TABLE public.site_enrollment_tokens DROP CONSTRAINT site_enrollment_tokens_created_by_foreign;
ALTER TABLE public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.operators(id);

ALTER TABLE public.site_operations DROP CONSTRAINT site_operations_requested_by_foreign;
ALTER TABLE public.site_operations
    ADD CONSTRAINT site_operations_requested_by_foreign FOREIGN KEY (requested_by) REFERENCES public.operators(id);
