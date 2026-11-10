-- Antrean lingkungan model tarik. Di CoreERP, baris environment_operations lahir sudah berjalan karena Core sendiri
-- yang menjalankannya. Di sini control plane hanya meminta, lalu worker di operations-metta mengambilnya (claim),
-- melapor langkah, dan menutupnya, sama dengan antrean situs. Karena itu baris punya status requested, waktu diminta,
-- dan parameter yang dibawa ke worker.
--
-- Jenis operasi dibatasi pada yang sudah ditulis kode: provision. Jenis lain ditambahkan migration yang datang
-- bersama kodenya. Hash password admin pertama hanya boleh ada selama operasinya terbuka.

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    DROP CONSTRAINT environment_operations_status_dikenal,
    DROP CONSTRAINT environment_operations_selesai_sejalan,
    ALTER COLUMN started_at DROP NOT NULL,
    ADD COLUMN requested_at timestamp(0) without time zone DEFAULT (now() AT TIME ZONE 'utc') NOT NULL,
    ADD COLUMN parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    ADD CONSTRAINT environment_operations_jenis_dikenal CHECK (operation IN ('provision')),
    ADD CONSTRAINT environment_operations_status_dikenal
        CHECK (status IN ('requested', 'running', 'succeeded', 'failed')),
    ADD CONSTRAINT environment_operations_selesai_sejalan
        CHECK ((status IN ('requested', 'running')) = (finished_at IS NULL)),
    ADD CONSTRAINT environment_operations_mulai_sejalan CHECK ((status = 'requested') = (started_at IS NULL)),
    ADD CONSTRAINT environment_operations_hash_hanya_saat_terbuka
        CHECK (status IN ('requested', 'running') OR NOT (parameters -> 'admin') ? 'password_hash');

ALTER TABLE public.environment_operations ALTER COLUMN requested_at DROP DEFAULT;

-- Satu lingkungan hanya punya satu operasi terbuka, diminta atau berjalan.
DROP INDEX public.environment_operations_satu_berjalan;
CREATE UNIQUE INDEX environment_operations_satu_terbuka ON public.environment_operations USING btree (environment_id)
    WHERE ((status)::text IN ('requested', 'running'));

-- Yang membuat lingkungan dan meminta operasinya selalu operator konsol, sama dengan tabel situs di 0005.
ALTER TABLE public.environments DROP CONSTRAINT environments_created_by_foreign;
ALTER TABLE public.environments
    ADD CONSTRAINT environments_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.operators(id);
ALTER TABLE public.environment_operations DROP CONSTRAINT environment_operations_requested_by_foreign;
ALTER TABLE public.environment_operations
    ADD CONSTRAINT environment_operations_requested_by_foreign
        FOREIGN KEY (requested_by) REFERENCES public.operators(id);

-- Permintaan pembuatan customer yang diulang dengan kunci yang sama menemukan hasil pertamanya, tidak membuat customer
-- kedua. request_hash menolak kunci yang sama dengan isi berbeda.
CREATE TABLE public.customer_creation_requests (
    idempotency_key uuid NOT NULL,
    request_hash character(64) NOT NULL,
    client_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    environment_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp(0) without time zone NOT NULL,
    CONSTRAINT customer_creation_requests_pkey PRIMARY KEY (idempotency_key),
    CONSTRAINT customer_creation_requests_client_id_foreign FOREIGN KEY (client_id) REFERENCES public.clients(id),
    CONSTRAINT customer_creation_requests_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
    CONSTRAINT customer_creation_requests_environment_id_foreign
        FOREIGN KEY (environment_id) REFERENCES public.environments(id),
    CONSTRAINT customer_creation_requests_operation_id_foreign
        FOREIGN KEY (operation_id) REFERENCES public.environment_operations(id),
    CONSTRAINT customer_creation_requests_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.operators(id)
);
