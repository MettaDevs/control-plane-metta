-- Skema awal control plane: 24 tabel sisi pusat CoreERP pada commit 6b3cf584, sesudah id ULID dan id pengguna
-- menjadi uuid oleh migration 0001 sampai 0003 operations-metta. Daftar tabelnya modelSisiPusat() di
-- apps/core/tests/Feature/Boundary/BatasPusatTest.php CoreERP, ditambah external_identities, passkeys, dan
-- sso_login_attempts. Isinya keluaran pg_dump --schema-only --no-owner --no-privileges untuk tabel-tabel itu, dengan
-- tiga perubahan:
--   - Baris \restrict dan \unrestrict dibuang, karena keduanya perintah psql, bukan SQL.
--   - Dua function trigger yang dipakai tabel ini ikut disalin: coreerp_bump_row_version() untuk tenant_memberships,
--     dan operator_audit_events_tolak_ubah() yang membuat jejak audit operator hanya bisa ditambah.
--   - passkeys.id menjadi uuid tanpa sequence. Di CoreERP ia satu-satunya id bigint di tabel-tabel ini, sedangkan di
--     repo ini setiap id baru dibuat aplikasi dengan Bun.randomUUIDv7().
-- Tidak ada foreign key ke tabel di luar daftar. Foreign key dari tabel operations ke tenants, users, dan
-- tenant_memberships tetap di operations-metta sampai tabel pusat dicabut dari sana.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: coreerp_bump_row_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.coreerp_bump_row_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Argumen trigger: kolom aktivitas mesin. Yang berubah hanya kolom itu: versi tetap.
    IF TG_NARGS > 0 AND to_jsonb(NEW) <> to_jsonb(OLD)
       AND (to_jsonb(NEW) - TG_ARGV) = (to_jsonb(OLD) - TG_ARGV) THEN
        NEW.version := OLD.version;
    ELSE
        NEW.version := OLD.version + 1;
    END IF;
    RETURN NEW;
END
$$;


--
-- Name: operator_audit_events_tolak_ubah(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.operator_audit_events_tolak_ubah() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'operator_audit_events hanya boleh ditambah, tidak diubah atau dihapus';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid NOT NULL,
    legal_name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: console_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.console_settings (
    key character varying(80) NOT NULL,
    value text NOT NULL,
    updated_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by uuid
);


--
-- Name: environment_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_operations (
    id uuid NOT NULL,
    environment_id uuid NOT NULL,
    operation character varying(30) NOT NULL,
    status character varying(20) NOT NULL,
    requested_by uuid,
    source_environment_id uuid,
    step character varying(60),
    failure_message text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp(0) without time zone NOT NULL,
    finished_at timestamp(0) without time zone,
    lease_until timestamp(0) without time zone,
    CONSTRAINT environment_operations_berjalan_bertenggat CHECK ((((status)::text <> 'running'::text) OR (lease_until IS NOT NULL))),
    CONSTRAINT environment_operations_gagal_beralasan CHECK ((((status)::text <> 'failed'::text) OR (failure_message IS NOT NULL))),
    CONSTRAINT environment_operations_jenis_dikenal CHECK (((operation)::text = ANY (ARRAY[('provision'::character varying)::text, ('copy'::character varying)::text, ('migrate'::character varying)::text, ('convert'::character varying)::text, ('disarm'::character varying)::text, ('suspend'::character varying)::text, ('resume'::character varying)::text, ('soft_delete'::character varying)::text, ('restore'::character varying)::text, ('purge'::character varying)::text, ('expire'::character varying)::text]))),
    CONSTRAINT environment_operations_selesai_sejalan CHECK ((((status)::text = 'running'::text) = (finished_at IS NULL))),
    CONSTRAINT environment_operations_status_dikenal CHECK (((status)::text = ANY (ARRAY[('running'::character varying)::text, ('succeeded'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: environments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(120) NOT NULL,
    database_name character varying(63),
    status character varying(20) NOT NULL,
    source_environment_id uuid,
    copied_at timestamp(0) without time zone,
    expires_at timestamp(0) without time zone,
    outbound_allowed boolean NOT NULL,
    schema_migrated_at timestamp(0) without time zone,
    schema_fingerprint character varying(255),
    deleted_at timestamp(0) without time zone,
    purge_after timestamp(0) without time zone,
    created_by uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    purged_at timestamp(0) without time zone,
    hosting character varying(20) DEFAULT 'provider'::character varying NOT NULL,
    CONSTRAINT environments_buang_sesudah_hapus_lunak CHECK (((purged_at IS NULL) OR (deleted_at IS NOT NULL))),
    CONSTRAINT environments_demo_berakhir CHECK ((((kind)::text <> 'demo'::text) OR (expires_at IS NOT NULL))),
    CONSTRAINT environments_hapus_berpasangan CHECK (((deleted_at IS NULL) = (purge_after IS NULL))),
    CONSTRAINT environments_hosting_dikenal CHECK (((hosting)::text = ANY (ARRAY[('provider'::character varying)::text, ('client_server'::character varying)::text]))),
    CONSTRAINT environments_keluar_ikut_jenis CHECK ((outbound_allowed = ((kind)::text = 'production'::text))),
    CONSTRAINT environments_kind_dikenal CHECK (((kind)::text = ANY (ARRAY[('production'::character varying)::text, ('sandbox'::character varying)::text, ('demo'::character varying)::text]))),
    CONSTRAINT environments_produksi_tidak_dibuang CHECK (((purged_at IS NULL) OR ((kind)::text <> 'production'::text))),
    CONSTRAINT environments_server_klien_hanya_produksi CHECK ((((hosting)::text = 'provider'::text) OR (((kind)::text = 'production'::text) AND (database_name IS NULL)))),
    CONSTRAINT environments_status_dikenal CHECK (((status)::text = ANY (ARRAY[('provisioning'::character varying)::text, ('copying'::character varying)::text, ('active'::character varying)::text, ('maintenance'::character varying)::text, ('degraded'::character varying)::text, ('suspended'::character varying)::text, ('soft_deleted'::character varying)::text]))),
    CONSTRAINT environments_status_hapus_sejalan CHECK ((((status)::text = 'soft_deleted'::text) = (deleted_at IS NOT NULL))),
    CONSTRAINT environments_sumber_hanya_sandbox CHECK (((source_environment_id IS NULL) OR ((kind)::text = 'sandbox'::text)))
);


--
-- Name: external_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_identities (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    issuer character varying(255) NOT NULL,
    subject character varying(255) NOT NULL,
    email_at_link character varying(255),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone
);


--
-- Name: managed_product_tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.managed_product_tenants (
    id uuid NOT NULL,
    product character varying(60) NOT NULL,
    profile character varying(60) NOT NULL,
    name character varying(150) NOT NULL,
    slug character varying(63) NOT NULL,
    owner_name character varying(100) NOT NULL,
    owner_email character varying(250) NOT NULL,
    idempotency_key uuid NOT NULL,
    request_hash character varying(64) NOT NULL,
    release jsonb NOT NULL,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    public_url text,
    failure_message text,
    lease_until timestamp(0) without time zone,
    expires_at timestamp(0) without time zone,
    requested_by uuid,
    retry_requested boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    owner_customer_id uuid,
    pending_sso_revocation jsonb,
    CONSTRAINT managed_product_tenants_status CHECK (((status)::text = ANY (ARRAY[('queued'::character varying)::text, ('provisioning'::character varying)::text, ('ready'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: operator_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_audit_events (
    id uuid NOT NULL,
    user_id uuid,
    action character varying(60) NOT NULL,
    subject_type character varying(40) NOT NULL,
    subject_id character varying(40),
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address character varying(45),
    occurred_at timestamp(0) without time zone NOT NULL
);


--
-- Name: passkeys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkeys (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    credential_id character varying(255) NOT NULL,
    credential json NOT NULL,
    last_used_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: product_auth_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_auth_attempts (
    state_hash character varying(64) NOT NULL,
    id uuid NOT NULL,
    browser_challenge character varying(64) NOT NULL,
    nonce character varying(128) NOT NULL,
    code_verifier text NOT NULL,
    expires_at timestamp(0) with time zone NOT NULL,
    consumed_at timestamp(0) with time zone,
    created_at timestamp(0) with time zone,
    updated_at timestamp(0) with time zone,
    deleted_at timestamp(0) with time zone
);


--
-- Name: product_customer_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_customer_sessions (
    token_hash character varying(64) NOT NULL,
    customer_id uuid NOT NULL,
    expires_at timestamp(0) with time zone NOT NULL,
    revoked_at timestamp(0) with time zone,
    created_at timestamp(0) with time zone,
    updated_at timestamp(0) with time zone,
    deleted_at timestamp(0) with time zone
);


--
-- Name: product_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_customers (
    id uuid NOT NULL,
    identity_hash character varying(64) NOT NULL,
    issuer text NOT NULL,
    subject character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(250),
    verified_email character varying(250),
    email_verified_at timestamp(0) with time zone,
    created_at timestamp(0) with time zone,
    updated_at timestamp(0) with time zone,
    deleted_at timestamp(0) with time zone,
    user_id uuid
);


--
-- Name: product_email_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_email_challenges (
    token_hash character varying(64) NOT NULL,
    customer_id uuid NOT NULL,
    email character varying(250) NOT NULL,
    expires_at timestamp(0) with time zone NOT NULL,
    consumed_at timestamp(0) with time zone,
    created_at timestamp(0) with time zone,
    updated_at timestamp(0) with time zone,
    deleted_at timestamp(0) with time zone
);


--
-- Name: provider_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_access (
    user_id uuid NOT NULL,
    role character varying(30) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: site_enrollment_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_enrollment_tokens (
    id uuid NOT NULL,
    site_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    expires_at timestamp(0) without time zone NOT NULL,
    used_at timestamp(0) without time zone,
    created_by uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: site_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_operations (
    id uuid NOT NULL,
    site_id uuid NOT NULL,
    operation character varying(30) NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) NOT NULL,
    requested_by uuid,
    step character varying(120),
    failure_message text,
    requested_at timestamp(0) without time zone NOT NULL,
    expires_at timestamp(0) without time zone NOT NULL,
    started_at timestamp(0) without time zone,
    lease_until timestamp(0) without time zone,
    finished_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    registry_robot_id bigint,
    registry_robot_name character varying(255),
    CONSTRAINT site_operations_berjalan_bertenggat CHECK ((((status)::text <> 'running'::text) OR ((lease_until IS NOT NULL) AND (started_at IS NOT NULL)))),
    CONSTRAINT site_operations_gagal_beralasan CHECK ((((status)::text <> 'failed'::text) OR (failure_message IS NOT NULL))),
    CONSTRAINT site_operations_hash_sandi_hanya_saat_terbuka CHECK ((((status)::text = ANY (ARRAY[('requested'::character varying)::text, ('running'::character varying)::text])) OR (NOT (parameters ? 'admin_password_hash'::text)))),
    CONSTRAINT site_operations_jenis_dikenal CHECK (((operation)::text = ANY (ARRAY[('install'::character varying)::text, ('upgrade'::character varying)::text, ('backup'::character varying)::text, ('install_license'::character varying)::text, ('rotate_key'::character varying)::text, ('send_diagnostics'::character varying)::text]))),
    CONSTRAINT site_operations_robot_berpasangan CHECK (((registry_robot_id IS NULL) = (registry_robot_name IS NULL))),
    CONSTRAINT site_operations_robot_hanya_penarik CHECK (((registry_robot_id IS NULL) OR ((operation)::text = ANY (ARRAY[('install'::character varying)::text, ('upgrade'::character varying)::text])))),
    CONSTRAINT site_operations_selesai_sejalan CHECK ((((status)::text = ANY (ARRAY[('requested'::character varying)::text, ('running'::character varying)::text])) = (finished_at IS NULL))),
    CONSTRAINT site_operations_status_dikenal CHECK (((status)::text = ANY (ARRAY[('requested'::character varying)::text, ('running'::character varying)::text, ('succeeded'::character varying)::text, ('failed'::character varying)::text, ('cancelled'::character varying)::text, ('expired'::character varying)::text])))
);


--
-- Name: site_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_releases (
    id uuid NOT NULL,
    edition character varying(80) NOT NULL,
    release character varying(40) NOT NULL,
    image character varying(255) NOT NULL,
    digest character varying(100) NOT NULL,
    manifest text NOT NULL,
    compose text NOT NULL,
    update_script text NOT NULL,
    checksums text NOT NULL,
    signature text NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: site_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_reports (
    id uuid NOT NULL,
    site_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_hash character(64) NOT NULL,
    reported_at timestamp(0) without time zone NOT NULL,
    received_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    profile character varying(30) NOT NULL,
    edition character varying(80) NOT NULL,
    address character varying(255),
    update_window_start time(0) without time zone,
    update_window_end time(0) without time zone,
    timezone character varying(40) DEFAULT 'Asia/Jakarta'::character varying NOT NULL,
    public_key text,
    enrolled_at timestamp(0) without time zone,
    revoked_at timestamp(0) without time zone,
    reported_edition character varying(80),
    reported_release character varying(40),
    reported_digest character varying(100),
    last_seen_at timestamp(0) without time zone,
    last_report jsonb,
    created_by uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    environment_id uuid,
    license_issued_at timestamp(0) without time zone,
    license_valid_until date,
    license_suspended_at timestamp(0) without time zone,
    server_address character varying(255),
    last_seen_ip character varying(45),
    dns_record_id character varying(64),
    dns_name character varying(255),
    dns_target character varying(255),
    dns_synced_at timestamp(0) without time zone,
    license_perpetual boolean DEFAULT false NOT NULL,
    license_valid_days smallint,
    license_renew_before_days smallint,
    license_issued_perpetual boolean DEFAULT false NOT NULL,
    CONSTRAINT sites_alamat_server_polos CHECK (((server_address IS NULL) OR (((server_address)::text <> ''::text) AND ((server_address)::text = lower((server_address)::text)) AND ((server_address)::text !~ '[[:space:]/@]'::text)))),
    CONSTRAINT sites_dns_berpasangan CHECK ((((dns_record_id IS NULL) = (dns_name IS NULL)) AND ((dns_name IS NULL) = (dns_target IS NULL)) AND ((dns_target IS NULL) = (dns_synced_at IS NULL)))),
    CONSTRAINT sites_jendela_berpasangan CHECK (((update_window_start IS NULL) = (update_window_end IS NULL))),
    CONSTRAINT sites_kunci_berpasangan CHECK (((public_key IS NULL) = (enrolled_at IS NULL))),
    CONSTRAINT sites_lisensi_berpasangan CHECK ((((license_issued_at IS NULL) AND (license_valid_until IS NULL) AND (license_issued_perpetual = false)) OR ((license_issued_at IS NOT NULL) AND (license_valid_until IS NOT NULL) AND (license_issued_perpetual = false)) OR ((license_issued_at IS NOT NULL) AND (license_valid_until IS NULL) AND (license_issued_perpetual = true)))),
    CONSTRAINT sites_masa_lisensi_masuk_akal CHECK ((((license_valid_days IS NULL) OR ((license_valid_days >= 1) AND (license_valid_days <= 3650))) AND ((license_renew_before_days IS NULL) OR ((license_renew_before_days >= 1) AND (license_renew_before_days <= 365))) AND ((license_valid_days IS NULL) OR (license_renew_before_days IS NULL) OR (license_renew_before_days < license_valid_days)))),
    CONSTRAINT sites_profil_dikenal CHECK (((profile)::text = 'managed_on_prem'::text))
);


--
-- Name: sso_login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sso_login_attempts (
    id uuid NOT NULL,
    state_hash character varying(64) NOT NULL,
    browser_secret_hash character varying(64) NOT NULL,
    nonce character varying(64) NOT NULL,
    code_verifier text NOT NULL,
    tenant_id uuid NOT NULL,
    environment_id uuid NOT NULL,
    return_origin character varying(255) NOT NULL,
    redirect_uri character varying(255) NOT NULL,
    user_id uuid,
    link_user_id uuid,
    subject character varying(255),
    subject_email character varying(255),
    handoff_token_hash character varying(64),
    expires_at timestamp(0) without time zone NOT NULL,
    completed_at timestamp(0) without time zone,
    consumed_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    invitation_id uuid
);


--
-- Name: tenant_creation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_creation_requests (
    id uuid NOT NULL,
    actor_scope character varying(100) NOT NULL,
    idempotency_key uuid NOT NULL,
    request_hash character varying(64) NOT NULL,
    actor_user_id uuid,
    principal_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone
);


--
-- Name: tenant_identity_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_identity_providers (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    mode character varying(20) NOT NULL,
    protokol character varying(20),
    setelan jsonb DEFAULT '{}'::jsonb NOT NULL,
    domain_email jsonb DEFAULT '[]'::jsonb NOT NULL,
    aktif boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT tenant_idp_aktif_bukan_lokal CHECK (((aktif = false) OR ((mode)::text <> 'lokal'::text))),
    CONSTRAINT tenant_idp_mode_dikenal CHECK (((mode)::text = ANY (ARRAY[('lokal'::character varying)::text, ('bersama'::character varying)::text, ('sendiri'::character varying)::text]))),
    CONSTRAINT tenant_idp_protokol_dikenal CHECK (((protokol IS NULL) OR ((protokol)::text = ANY (ARRAY[('oidc'::character varying)::text, ('saml'::character varying)::text])))),
    CONSTRAINT tenant_idp_sendiri_berprotokol CHECK ((((mode)::text <> 'sendiri'::text) OR (protokol IS NOT NULL)))
);


--
-- Name: tenant_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_memberships (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    email_verified_at timestamp(0) without time zone,
    password character varying(255) NOT NULL,
    remember_token character varying(100),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    two_factor_secret text,
    two_factor_recovery_codes text,
    two_factor_confirmed_at timestamp(0) without time zone,
    last_login_at timestamp(0) without time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    account_type character varying(20) DEFAULT 'person'::character varying NOT NULL,
    timezone character varying(40),
    CONSTRAINT users_account_type_check CHECK (((account_type)::text = ANY (ARRAY[('person'::character varying)::text, ('application'::character varying)::text])))
);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: clients clients_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_slug_unique UNIQUE (slug);


--
-- Name: console_settings console_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.console_settings
    ADD CONSTRAINT console_settings_pkey PRIMARY KEY (key);


--
-- Name: environment_operations environment_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT environment_operations_pkey PRIMARY KEY (id);


--
-- Name: environments environments_database_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_database_name_unique UNIQUE (database_name);


--
-- Name: environments environments_id_tenant_unik; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_id_tenant_unik UNIQUE (id, tenant_id);


--
-- Name: environments environments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_pkey PRIMARY KEY (id);


--
-- Name: external_identities external_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identities
    ADD CONSTRAINT external_identities_pkey PRIMARY KEY (id);


--
-- Name: managed_product_tenants managed_product_tenants_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_product_tenants
    ADD CONSTRAINT managed_product_tenants_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: managed_product_tenants managed_product_tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_product_tenants
    ADD CONSTRAINT managed_product_tenants_pkey PRIMARY KEY (id);


--
-- Name: operator_audit_events operator_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_audit_events
    ADD CONSTRAINT operator_audit_events_pkey PRIMARY KEY (id);


--
-- Name: passkeys passkeys_credential_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_credential_id_unique UNIQUE (credential_id);


--
-- Name: passkeys passkeys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_pkey PRIMARY KEY (id);


--
-- Name: product_auth_attempts product_auth_attempts_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_auth_attempts
    ADD CONSTRAINT product_auth_attempts_id_unique UNIQUE (id);


--
-- Name: product_auth_attempts product_auth_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_auth_attempts
    ADD CONSTRAINT product_auth_attempts_pkey PRIMARY KEY (state_hash);


--
-- Name: product_customer_sessions product_customer_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customer_sessions
    ADD CONSTRAINT product_customer_sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: product_customers product_customers_identity_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customers
    ADD CONSTRAINT product_customers_identity_hash_unique UNIQUE (identity_hash);


--
-- Name: product_customers product_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customers
    ADD CONSTRAINT product_customers_pkey PRIMARY KEY (id);


--
-- Name: product_email_challenges product_email_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_email_challenges
    ADD CONSTRAINT product_email_challenges_pkey PRIMARY KEY (token_hash);


--
-- Name: provider_access provider_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_access
    ADD CONSTRAINT provider_access_pkey PRIMARY KEY (user_id);


--
-- Name: site_enrollment_tokens site_enrollment_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_pkey PRIMARY KEY (id);


--
-- Name: site_enrollment_tokens site_enrollment_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_token_hash_unique UNIQUE (token_hash);


--
-- Name: site_operations site_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_operations
    ADD CONSTRAINT site_operations_pkey PRIMARY KEY (id);


--
-- Name: site_releases site_releases_edition_release_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_releases
    ADD CONSTRAINT site_releases_edition_release_unique UNIQUE (edition, release);


--
-- Name: site_releases site_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_releases
    ADD CONSTRAINT site_releases_pkey PRIMARY KEY (id);


--
-- Name: site_reports site_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_reports
    ADD CONSTRAINT site_reports_pkey PRIMARY KEY (id);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: sites sites_tenant_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_tenant_id_name_unique UNIQUE (tenant_id, name);


--
-- Name: sso_login_attempts sso_login_attempts_handoff_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_handoff_token_hash_unique UNIQUE (handoff_token_hash);


--
-- Name: sso_login_attempts sso_login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_pkey PRIMARY KEY (id);


--
-- Name: sso_login_attempts sso_login_attempts_state_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_state_hash_unique UNIQUE (state_hash);


--
-- Name: tenant_creation_requests tenant_creation_actor_request_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_actor_request_unique UNIQUE (actor_scope, idempotency_key);


--
-- Name: tenant_creation_requests tenant_creation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_pkey PRIMARY KEY (id);


--
-- Name: tenant_identity_providers tenant_identity_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_identity_providers
    ADD CONSTRAINT tenant_identity_providers_pkey PRIMARY KEY (id);


--
-- Name: tenant_identity_providers tenant_identity_providers_tenant_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_identity_providers
    ADD CONSTRAINT tenant_identity_providers_tenant_id_unique UNIQUE (tenant_id);


--
-- Name: tenant_memberships tenant_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (id);


--
-- Name: tenant_memberships tenant_memberships_tenant_id_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_user_id_unique UNIQUE (tenant_id, user_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: environment_operations_environment_id_started_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX environment_operations_environment_id_started_at_index ON public.environment_operations USING btree (environment_id, started_at);


--
-- Name: environment_operations_satu_berjalan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environment_operations_satu_berjalan ON public.environment_operations USING btree (environment_id) WHERE ((status)::text = 'running'::text);


--
-- Name: environment_operations_satu_salinan_per_sumber; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environment_operations_satu_salinan_per_sumber ON public.environment_operations USING btree (source_environment_id) WHERE (((status)::text = 'running'::text) AND (source_environment_id IS NOT NULL));


--
-- Name: environments_satu_per_jenis; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environments_satu_per_jenis ON public.environments USING btree (tenant_id, kind) WHERE (((kind)::text = ANY (ARRAY[('demo'::character varying)::text, ('sandbox'::character varying)::text])) AND (deleted_at IS NULL));


--
-- Name: environments_satu_produksi; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environments_satu_produksi ON public.environments USING btree (tenant_id) WHERE (((kind)::text = 'production'::text) AND (deleted_at IS NULL));


--
-- Name: environments_slug_per_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environments_slug_per_tenant ON public.environments USING btree (tenant_id, slug) WHERE (deleted_at IS NULL);


--
-- Name: environments_tenant_id_kind_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX environments_tenant_id_kind_index ON public.environments USING btree (tenant_id, kind);


--
-- Name: external_identities_issuer_subject_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX external_identities_issuer_subject_unique ON public.external_identities USING btree (issuer, subject) WHERE (deleted_at IS NULL);


--
-- Name: external_identities_user_id_issuer_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX external_identities_user_id_issuer_unique ON public.external_identities USING btree (user_id, issuer) WHERE (deleted_at IS NULL);


--
-- Name: managed_product_tenants_customer_product_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX managed_product_tenants_customer_product_active ON public.managed_product_tenants USING btree (owner_customer_id, product) WHERE ((deleted_at IS NULL) AND (owner_customer_id IS NOT NULL));


--
-- Name: managed_product_tenants_product_slug_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX managed_product_tenants_product_slug_active ON public.managed_product_tenants USING btree (product, slug) WHERE (deleted_at IS NULL);


--
-- Name: managed_product_tenants_status_lease_until_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX managed_product_tenants_status_lease_until_index ON public.managed_product_tenants USING btree (status, lease_until);


--
-- Name: operator_audit_events_subject_type_subject_id_occurred_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operator_audit_events_subject_type_subject_id_occurred_at_index ON public.operator_audit_events USING btree (subject_type, subject_id, occurred_at);


--
-- Name: operator_audit_events_user_id_occurred_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operator_audit_events_user_id_occurred_at_index ON public.operator_audit_events USING btree (user_id, occurred_at);


--
-- Name: passkeys_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX passkeys_user_id_index ON public.passkeys USING btree (user_id);


--
-- Name: product_customer_sessions_customer_id_expires_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_customer_sessions_customer_id_expires_at_index ON public.product_customer_sessions USING btree (customer_id, expires_at);


--
-- Name: product_customers_verified_email_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_customers_verified_email_active ON public.product_customers USING btree (verified_email) WHERE ((deleted_at IS NULL) AND (verified_email IS NOT NULL));


--
-- Name: product_email_challenges_customer_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_email_challenges_customer_id_created_at_index ON public.product_email_challenges USING btree (customer_id, created_at);


--
-- Name: site_enrollment_tokens_site_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_enrollment_tokens_site_id_created_at_index ON public.site_enrollment_tokens USING btree (site_id, created_at);


--
-- Name: site_operations_robot_tersisa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_operations_robot_tersisa ON public.site_operations USING btree (site_id) WHERE (registry_robot_id IS NOT NULL);


--
-- Name: site_operations_satu_berjalan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX site_operations_satu_berjalan ON public.site_operations USING btree (site_id) WHERE ((status)::text = 'running'::text);


--
-- Name: site_operations_satu_permintaan_per_jenis; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX site_operations_satu_permintaan_per_jenis ON public.site_operations USING btree (site_id, operation) WHERE ((status)::text = 'requested'::text);


--
-- Name: site_operations_site_id_requested_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_operations_site_id_requested_at_index ON public.site_operations USING btree (site_id, requested_at);


--
-- Name: site_reports_site_id_received_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_reports_site_id_received_at_index ON public.site_reports USING btree (site_id, received_at);


--
-- Name: sites_satu_per_lingkungan; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sites_satu_per_lingkungan ON public.sites USING btree (environment_id) WHERE (environment_id IS NOT NULL);


--
-- Name: sso_login_attempts_invitation_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sso_login_attempts_invitation_id_index ON public.sso_login_attempts USING btree (invitation_id);


--
-- Name: tenant_memberships bump_row_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.tenant_memberships FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();


--
-- Name: operator_audit_events operator_audit_events_hanya_tambah; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operator_audit_events_hanya_tambah BEFORE DELETE OR UPDATE ON public.operator_audit_events FOR EACH ROW EXECUTE FUNCTION public.operator_audit_events_tolak_ubah();


--
-- Name: console_settings console_settings_updated_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.console_settings
    ADD CONSTRAINT console_settings_updated_by_foreign FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: environment_operations environment_operations_environment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT environment_operations_environment_id_foreign FOREIGN KEY (environment_id) REFERENCES public.environments(id) ON DELETE RESTRICT;


--
-- Name: environment_operations environment_operations_requested_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT environment_operations_requested_by_foreign FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: environments environments_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: environments environments_source_environment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_source_environment_id_foreign FOREIGN KEY (source_environment_id) REFERENCES public.environments(id) ON DELETE RESTRICT;


--
-- Name: environments environments_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;


--
-- Name: external_identities external_identities_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identities
    ADD CONSTRAINT external_identities_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: managed_product_tenants managed_product_tenants_owner_customer_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_product_tenants
    ADD CONSTRAINT managed_product_tenants_owner_customer_id_foreign FOREIGN KEY (owner_customer_id) REFERENCES public.product_customers(id);


--
-- Name: managed_product_tenants managed_product_tenants_requested_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_product_tenants
    ADD CONSTRAINT managed_product_tenants_requested_by_foreign FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: operator_audit_events operator_audit_events_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_audit_events
    ADD CONSTRAINT operator_audit_events_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: passkeys passkeys_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: product_customer_sessions product_customer_sessions_customer_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customer_sessions
    ADD CONSTRAINT product_customer_sessions_customer_id_foreign FOREIGN KEY (customer_id) REFERENCES public.product_customers(id);


--
-- Name: product_customers product_customers_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_customers
    ADD CONSTRAINT product_customers_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: product_email_challenges product_email_challenges_customer_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_email_challenges
    ADD CONSTRAINT product_email_challenges_customer_id_foreign FOREIGN KEY (customer_id) REFERENCES public.product_customers(id);


--
-- Name: provider_access provider_access_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_access
    ADD CONSTRAINT provider_access_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: site_enrollment_tokens site_enrollment_tokens_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: site_enrollment_tokens site_enrollment_tokens_site_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_enrollment_tokens
    ADD CONSTRAINT site_enrollment_tokens_site_id_foreign FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- Name: site_operations site_operations_requested_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_operations
    ADD CONSTRAINT site_operations_requested_by_foreign FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: site_operations site_operations_site_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_operations
    ADD CONSTRAINT site_operations_site_id_foreign FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- Name: site_reports site_reports_site_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_reports
    ADD CONSTRAINT site_reports_site_id_foreign FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- Name: sites sites_created_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sites sites_lingkungan_milik_tenant_yang_sama; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_lingkungan_milik_tenant_yang_sama FOREIGN KEY (environment_id, tenant_id) REFERENCES public.environments(id, tenant_id) ON DELETE RESTRICT;


--
-- Name: sites sites_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;


--
-- Name: sso_login_attempts sso_login_attempts_environment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_environment_id_foreign FOREIGN KEY (environment_id) REFERENCES public.environments(id) ON DELETE CASCADE;


--
-- Name: sso_login_attempts sso_login_attempts_link_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_link_user_id_foreign FOREIGN KEY (link_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sso_login_attempts sso_login_attempts_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sso_login_attempts sso_login_attempts_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_login_attempts
    ADD CONSTRAINT sso_login_attempts_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tenant_creation_requests tenant_creation_requests_actor_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_actor_user_id_foreign FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: tenant_creation_requests tenant_creation_requests_membership_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_membership_id_foreign FOREIGN KEY (membership_id) REFERENCES public.tenant_memberships(id);


--
-- Name: tenant_creation_requests tenant_creation_requests_principal_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_principal_id_foreign FOREIGN KEY (principal_id) REFERENCES public.users(id);


--
-- Name: tenant_creation_requests tenant_creation_requests_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_creation_requests
    ADD CONSTRAINT tenant_creation_requests_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tenant_identity_providers tenant_identity_providers_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_identity_providers
    ADD CONSTRAINT tenant_identity_providers_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_memberships tenant_memberships_tenant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_foreign FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_memberships tenant_memberships_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tenants tenants_client_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_client_id_foreign FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
