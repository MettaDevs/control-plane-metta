-- Susunan module: module yang biasa dijual bersama, misalnya untuk satu jenis faskes. Nama dan isinya diatur operator,
-- tidak ditulis di kode. Susunan hanya jalan pintas: memberinya ke tenant mengisi hak per module
-- (tenant_module_entitlements), dan susunan itu tidak dicatat sebagai hak tersendiri. Menghapus susunan berarti mengisi
-- deleted_at; hak yang sudah diberikan lewat susunan itu tidak berubah.

CREATE TABLE public.catalog_packages (
    id uuid NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    -- Daftar id catalog_modules, urut.
    module_ids jsonb NOT NULL,
    created_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    deleted_at timestamp(0) without time zone,
    CONSTRAINT catalog_packages_pkey PRIMARY KEY (id),
    CONSTRAINT catalog_packages_module_ids_daftar CHECK (jsonb_typeof(module_ids) = 'array')
);

CREATE UNIQUE INDEX catalog_packages_nama_unik
    ON public.catalog_packages (lower(name)) WHERE deleted_at IS NULL;
