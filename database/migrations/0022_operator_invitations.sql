-- Undangan operator. Operator yang sudah login mengundang lewat email; penyedia SSO mengirim tautan sekali pakai ke
-- penerima, lalu pemegang tautan login SSO di konsol dan lahir sebagai operator yang sudah tertaut ke akun SSO itu.
-- Sama dengan undangan portal: akun SSO tidak pernah ditautkan karena emailnya sama, yang membuktikan adalah tautan
-- yang sampai ke kotak masuk penerima, dan token hanya disimpan sebagai hash SHA-256. Membatalkan berarti mengisi
-- deleted_at.

CREATE TABLE public.operator_invitations (
    id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    recipient_email character varying(255) NOT NULL,
    recipient_name character varying(255),
    -- Kapan penyedia SSO menerima permintaan mengirim email undangan; kosong berarti belum terkirim.
    notified_at timestamp(0) without time zone,
    expires_at timestamp(0) without time zone NOT NULL,
    created_by uuid NOT NULL,
    accepted_at timestamp(0) without time zone,
    -- Operator yang lahir dari undangan ini, atau operator yang sudah tertaut ke akun SSO penerima.
    accepted_operator_id uuid,
    created_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    deleted_at timestamp(0) without time zone,
    CONSTRAINT operator_invitations_pkey PRIMARY KEY (id),
    CONSTRAINT operator_invitations_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT operator_invitations_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.operators(id),
    CONSTRAINT operator_invitations_accepted_operator_id_foreign FOREIGN KEY (accepted_operator_id)
        REFERENCES public.operators(id)
);

-- Paling banyak satu undangan yang belum dipakai per email, termasuk yang kedaluwarsa: undangan itu dikirim ulang,
-- bukan dibuat lagi.
CREATE UNIQUE INDEX operator_invitations_pending_email_unique
    ON public.operator_invitations (lower((recipient_email)::text))
    WHERE accepted_at IS NULL AND deleted_at IS NULL;

-- Operator dari undangan hanya masuk lewat SSO dan tidak punya password. Login password menolaknya dengan jawaban yang
-- sama dengan password salah.
ALTER TABLE public.operators ALTER COLUMN password DROP NOT NULL;
