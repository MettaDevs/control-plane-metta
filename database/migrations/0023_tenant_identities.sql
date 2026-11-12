-- Akun SSO yang ditautkan ke pengguna klinik, dan undangan portal per tenant.
--
-- Pengguna klinik masuk ke operations-metta dengan akun SSO yang sama dengan portal. Setiap undangan portal kini
-- menunjuk satu tenant dan satu jenis: `admin` (dikirim otomatis saat customer dibuat) atau `member` (dikirim operator
-- atau admin portal tenant itu). Menerima undangan menulis akses portal ke tenant itu dan satu baris tenant_identities
-- di transaksi yang sama. Undangan admin menautkan akun SSO ke admin pertama klinik (user_id); undangan member
-- meminta worker membuat pengguna klinik tanpa password dan tanpa role. Barisnya diterapkan ke setiap lingkungan aktif
-- tenant lewat operasi sync_identities, sama dengan sync_entitlements.
--
-- Mencabut akses portal tidak menghapus baris tenant_identities: akses ke klinik diatur di dalam klinik sendiri.

-- Id pengguna klinik admin pertama, yang dibuat worker dari parameter operasi provision (`admin.id`). Tenant lama
-- diisi dari operasi provision pertamanya.
ALTER TABLE public.tenants ADD COLUMN first_admin_user_id uuid;

UPDATE public.tenants t
SET first_admin_user_id = (
    SELECT (o.parameters -> 'admin' ->> 'id')::uuid
    FROM public.environment_operations o JOIN public.environments e ON e.id = o.environment_id
    WHERE e.tenant_id = t.id AND o.operation = 'provision' AND (o.parameters -> 'admin' ->> 'id') IS NOT NULL
    ORDER BY o.requested_at, o.id
    LIMIT 1
);

CREATE TABLE public.tenant_identities (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    issuer character varying(255) NOT NULL,
    subject character varying(255) NOT NULL,
    email character varying(255),
    name character varying(255),
    -- Pengguna klinik yang sudah ada untuk ditautkan; kosong berarti worker membuat pengguna baru tanpa role.
    user_id uuid,
    created_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    deleted_at timestamp(0) without time zone,
    CONSTRAINT tenant_identities_pkey PRIMARY KEY (id),
    CONSTRAINT tenant_identities_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE UNIQUE INDEX tenant_identities_satu_hidup
    ON public.tenant_identities (tenant_id, issuer, subject) WHERE deleted_at IS NULL;
-- Satu pengguna klinik paling banyak tertaut ke satu akun SSO per tenant.
CREATE UNIQUE INDEX tenant_identities_satu_pengguna
    ON public.tenant_identities (tenant_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.environments
    ADD COLUMN applied_identities jsonb;

ALTER TABLE public.environment_operations
    DROP CONSTRAINT environment_operations_jenis_dikenal,
    ADD CONSTRAINT environment_operations_jenis_dikenal
        CHECK (operation IN ('provision', 'migrate', 'convert', 'expire', 'restore', 'purge', 'sync_entitlements',
                             'sync_identities'));

-- Undangan dari portal tidak dibuat operator, jadi pengundangnya salah satu dari dua kolom.
ALTER TABLE public.client_portal_invitations
    ADD COLUMN tenant_id uuid,
    ADD COLUMN kind character varying(10),
    ADD COLUMN invited_by_portal_user_id uuid,
    ALTER COLUMN created_by DROP NOT NULL,
    ADD CONSTRAINT client_portal_invitations_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
    ADD CONSTRAINT client_portal_invitations_invited_by_portal_user_id_foreign FOREIGN KEY (invited_by_portal_user_id)
        REFERENCES public.client_portal_users(id);

-- Undangan lama menunjuk tenant pertama customernya dan menjadi undangan member: tidak ada yang dibuktikan
-- undangan itu tentang admin pertama klinik.
UPDATE public.client_portal_invitations i
SET tenant_id = (SELECT t.id FROM public.tenants t WHERE t.client_id = i.client_id ORDER BY t.created_at, t.id LIMIT 1),
    kind = 'member';

ALTER TABLE public.client_portal_invitations
    ALTER COLUMN tenant_id SET NOT NULL,
    ALTER COLUMN kind SET NOT NULL,
    ADD CONSTRAINT client_portal_invitations_jenis_dikenal CHECK (kind IN ('admin', 'member')),
    ADD CONSTRAINT client_portal_invitations_satu_pengundang
        CHECK (num_nonnulls(created_by, invited_by_portal_user_id) = 1);

-- Akses portal kini per tenant. is_admin: boleh mengundang anggota ke tenant itu. Akses lama mengikuti tenant
-- undangannya dan tetap admin, karena sebelum ini setiap pemegang akses portal adalah admin kliniknya.
ALTER TABLE public.client_portal_users
    ADD COLUMN tenant_id uuid,
    ADD COLUMN is_admin boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT client_portal_users_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

UPDATE public.client_portal_users u
SET tenant_id = i.tenant_id, is_admin = true
FROM public.client_portal_invitations i
WHERE i.id = u.invitation_id;

ALTER TABLE public.client_portal_users ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX public.client_portal_users_satu_hidup;
CREATE UNIQUE INDEX client_portal_users_satu_hidup
    ON public.client_portal_users (tenant_id, issuer, subject) WHERE deleted_at IS NULL;
