-- Host runtime: server tempat operations-metta menjalankan lingkungan milik kita. Worker di host itu menandatangani
-- setiap permintaan ke API worker dengan kunci privatnya, dan kunci publiknya tercatat di sini. Lingkungan terikat ke
-- host pertama yang mengambil operasi penyiapannya, karena database lingkungannya lahir di sana.

CREATE TABLE public.runtime_hosts (
    id uuid NOT NULL,
    name character varying(100) NOT NULL,
    public_key text NOT NULL,
    created_at timestamp(0) without time zone NOT NULL,
    revoked_at timestamp(0) without time zone,
    CONSTRAINT runtime_hosts_pkey PRIMARY KEY (id),
    CONSTRAINT runtime_hosts_name_unique UNIQUE (name)
);

ALTER TABLE public.environments
    ADD COLUMN runtime_host_id uuid,
    ADD CONSTRAINT environments_runtime_host_id_foreign
        FOREIGN KEY (runtime_host_id) REFERENCES public.runtime_hosts(id);
