-- Akses portal klien. Akun SSO ditautkan ke customer (clients), bukan ke operator, dan hanya lewat undangan: operator
-- membuat tautan sekali pakai yang dikirim penyedia SSO ke email penerima, lalu pemegang tautan itu login SSO di
-- portal. Akun SSO tidak pernah ditautkan hanya karena emailnya sama, karena penyedia SSO tidak memverifikasi email
-- pendaftar; yang membuktikan adalah tautan yang sampai ke kotak masuk penerima. Token undangan hanya disimpan sebagai
-- hash SHA-256. Mencabut akses atau membatalkan undangan berarti mengisi deleted_at.

CREATE TABLE public.client_portal_invitations (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    recipient_email character varying(255) NOT NULL,
    recipient_name character varying(255),
    -- Kapan penyedia SSO menerima permintaan mengirim email undangan; kosong berarti belum terkirim.
    notified_at timestamp(0) without time zone,
    expires_at timestamp(0) without time zone NOT NULL,
    created_by uuid NOT NULL,
    accepted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    deleted_at timestamp(0) without time zone,
    CONSTRAINT client_portal_invitations_pkey PRIMARY KEY (id),
    CONSTRAINT client_portal_invitations_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT client_portal_invitations_client_id_foreign FOREIGN KEY (client_id) REFERENCES public.clients(id),
    CONSTRAINT client_portal_invitations_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.operators(id)
);

-- Satu akun SSO boleh memegang beberapa customer, misalnya konsultan yang mengurus beberapa klinik, tetapi paling
-- banyak satu akses hidup per customer.
CREATE TABLE public.client_portal_users (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    issuer character varying(255) NOT NULL,
    subject character varying(255) NOT NULL,
    name_at_link character varying(255),
    email_at_link character varying(255),
    invitation_id uuid NOT NULL,
    created_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    deleted_at timestamp(0) without time zone,
    CONSTRAINT client_portal_users_pkey PRIMARY KEY (id),
    CONSTRAINT client_portal_users_client_id_foreign FOREIGN KEY (client_id) REFERENCES public.clients(id),
    CONSTRAINT client_portal_users_invitation_id_foreign FOREIGN KEY (invitation_id)
        REFERENCES public.client_portal_invitations(id)
);

CREATE UNIQUE INDEX client_portal_users_satu_hidup
    ON public.client_portal_users (client_id, issuer, subject) WHERE deleted_at IS NULL;
CREATE INDEX client_portal_users_identitas
    ON public.client_portal_users (issuer, subject) WHERE deleted_at IS NULL;
