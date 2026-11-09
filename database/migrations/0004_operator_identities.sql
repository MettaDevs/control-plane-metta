-- Identitas SSO yang ditautkan ke operator. Di CoreERP tautan operator ada di external_identities bersama tautan
-- pengguna customer, karena operator adalah baris users. Di sini operator terpisah, jadi tautannya juga terpisah, dan
-- external_identities tetap untuk pengguna customer.
--
-- Tautan selalu lewat issuer + subject (klaim iss dan sub), tidak pernah lewat email. Hanya operator yang sudah login dan
-- mengetik ulang password yang bisa menautkan; login SSO tidak pernah membuat operator. Melepas tautan mengisi
-- deleted_at, jadi indeks unik berlaku untuk baris yang belum dilepas saja.

CREATE TABLE public.operator_identities (
    id uuid PRIMARY KEY,
    operator_id uuid NOT NULL REFERENCES public.operators(id),
    issuer character varying(255) NOT NULL,
    subject character varying(255) NOT NULL,
    email_at_link character varying(255),
    created_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    deleted_at timestamp(0) without time zone
);

CREATE UNIQUE INDEX operator_identities_issuer_subject_unique ON public.operator_identities USING btree (issuer, subject)
    WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX operator_identities_operator_issuer_unique ON public.operator_identities USING btree (operator_id, issuer)
    WHERE (deleted_at IS NULL);
