-- Katalog module dan entitlement per tenant.
--
-- Katalog diisi laporan host runtime: setiap worker melaporkan module yang dibawa image-nya, jadi module yang bisa
-- dijual adalah module yang benar-benar terpasang di salah satu host. Entitlement menyatakan tenant berhak memakai satu
-- module sampai tanggal berakhirnya (kosong berarti tanpa batas). Mencabut berarti mengisi deleted_at; barisnya tetap.
--
-- Entitlement diterapkan ke setiap lingkungan hidup tenant lewat operasi sync_entitlements, yang diantrekan saat host
-- pemegangnya meminta pekerjaan dan applied_entitlements lingkungan itu berbeda dari entitlement tenant sekarang.

CREATE TABLE public.catalog_modules (
    id character varying(80) NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    first_reported_at timestamp(0) without time zone NOT NULL,
    last_reported_at timestamp(0) without time zone NOT NULL,
    CONSTRAINT catalog_modules_pkey PRIMARY KEY (id)
);

ALTER TABLE public.runtime_hosts
    ADD COLUMN reported_modules jsonb;

CREATE TABLE public.tenant_module_entitlements (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    module_id character varying(80) NOT NULL,
    ends_on date,
    created_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    deleted_at timestamp(0) without time zone,
    CONSTRAINT tenant_module_entitlements_pkey PRIMARY KEY (id),
    CONSTRAINT tenant_module_entitlements_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
    CONSTRAINT tenant_module_entitlements_module_id_foreign FOREIGN KEY (module_id) REFERENCES public.catalog_modules(id)
);

CREATE UNIQUE INDEX tenant_module_entitlements_satu_hidup
    ON public.tenant_module_entitlements (tenant_id, module_id) WHERE deleted_at IS NULL;

ALTER TABLE public.environments
    ADD COLUMN applied_entitlements jsonb;

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    ADD CONSTRAINT environment_operations_jenis_dikenal
        CHECK (operation IN ('provision', 'migrate', 'convert', 'expire', 'restore', 'purge', 'sync_entitlements'));
