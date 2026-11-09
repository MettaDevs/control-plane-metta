-- console_settings.updated_by menunjuk operator, bukan pengguna customer, sama dengan kolom aktor di 0002 dan 0005.
-- Setelan yang ditulis dari CLI tidak punya operator, jadi kolomnya kosong.

ALTER TABLE public.console_settings DROP CONSTRAINT console_settings_updated_by_foreign;
ALTER TABLE public.console_settings
    ADD CONSTRAINT console_settings_updated_by_foreign FOREIGN KEY (updated_by) REFERENCES public.operators(id);
