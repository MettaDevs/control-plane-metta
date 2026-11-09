---
name: control-plane-metta-console
description: Work safely on the operator console of control-plane-metta and on the agent API it will serve. Use when touching `src/console.ts`, `src/agent.ts`, `src/cli.ts`, or anything under `src/platform/operator-identity/`, `src/platform/audit/`, or `src/platform/rate-limit/`; operator login, sessions, 2FA, or SSO; the operator audit trail; central tables in `database/migrations/` (`operators`, `operator_identities`, `operator_audit_events`, `sites`, `site_*`, `environments`, `console_settings`); or `contracts/agent/`. Also use when adding a console route, an audited action, a CLI command, or a console setting, and when porting a flow from CoreERP's operator console, such as sites, the agent API, licences, DNS, environments, or console settings.
---

# control-plane-metta operator console

The console is the only application operated by us rather than by a clinic. It will create tenants and environments,
manage client servers through their agents, and hold settings that must not live in a server's environment file. Today
it holds operator accounts and their login; every other flow is still in CoreERP.

This skill moved here from CoreERP's `coreerp-konsol` on 9 November 2026. CoreERP's console (`apps/control-plane`,
Laravel) stays the behaviour reference for every flow not yet ported. The CoreERP repository is no longer changed, so a
difference found there is reported to the product owner to decide whether to copy or fix it, never fixed silently.

## What exists here

| Part | Code |
| --- | --- |
| Operator accounts and `create-operator` | `src/platform/operator-identity/operator.service.ts`, `src/cli.ts` |
| Password login, logout, `GET /api/v1/me` | `src/platform/operator-identity/login/login.console.routes.ts` |
| Session cookie, JSON-only mutations, attempt limits | `src/platform/operator-identity/session.console.ts`, `session-cookie.ts`, `src/platform/rate-limit/` |
| 2FA (TOTP, optional) | `src/platform/operator-identity/two-factor/` |
| Operator SSO (OpenID Connect) | `src/platform/operator-identity/sso/` |
| Encryption of 2FA secrets and the SSO ceremony cookie | `src/platform/operator-identity/secret-box.ts` |
| Operator audit trail | `src/platform/audit/` (`recordAudit()`) |
| Central schema | `database/migrations/`: `0001_baseline.sql` (the 24 central tables of CoreERP), then operators, their 2FA columns, and `operator_identities` |

Routes, environment variables, and the rules of these parts are in `AGENTS.md`, section "Konsol dan portal". Read them
there; this skill does not restate them.

## What has not moved yet

None of the following exists here. `src/agent.ts` answers only `/up`, and `contracts/agent/` does not exist yet. Read
the CoreERP code for the behaviour, then port it into the place that the "Susunan repo" table in `AGENTS.md` gives it.

| Flow | Place here | Behaviour reference in CoreERP |
| --- | --- | --- |
| Agent API: enrollment, signed requests, report, operation queue, release files, key rotation | `src/sites/`, routes in `*.agent.routes.ts`, contract in `contracts/agent/` | [`AgentApi.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Http/Controllers/Agent/AgentApi.php), [`VerifyAgentSignature.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Http/Middleware/VerifyAgentSignature.php), [`app/Sites/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/app/Sites), [`openapi-agent.yaml`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/contracts/openapi-agent.yaml), the agent [`deploy/agent/coreerp-agent`](https://github.com/MettaDevs/coreERP/blob/main/deploy/agent/coreerp-agent) |
| Site licences | `src/sites/` | [`LicenseIssuer.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Sites/LicenseIssuer.php), [`LicenseRenewal.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Sites/LicenseRenewal.php), [`LicenseTerms.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Sites/LicenseTerms.php) |
| DNS for client servers | `src/settings/` | [`app/Dns/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/app/Dns), [`SiteDns.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Sites/SiteDns.php) |
| Customers, tenant registry, entitlement | `src/customers/` | [`app/Customers/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/app/Customers), [`EntitlementsFromCore.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Sites/EntitlementsFromCore.php) |
| Environments: registry, operations with a lease, provisioning, upgrade, copy, purge | `src/environments/` | [`app/Environments/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/app/Environments); the provisioning engine itself was in Core, [`Platform/ControlPlane`](https://github.com/MettaDevs/coreERP/tree/main/apps/core/app/Platform/ControlPlane) |
| Console settings | `src/settings/` | [`Settings.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Http/Controllers/Settings.php), [`SettingsLicense.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Http/Controllers/SettingsLicense.php), [`app/Console/Commands/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/app/Console/Commands) |
| Releases, Harbor, registry credentials | `src/releases/`; see skill `control-plane-metta-release` | [`app/Registry/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/app/Registry), [`ReleaseRegistry.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Sites/ReleaseRegistry.php) |
| Old product tenants | `src/products/` | [`ProductTenants.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Products/ProductTenants.php) |
| Console screens | `*.console.page.tsx` in the feature folder, frame in `src/platform/shell/`; the UI framework is not chosen | [`resources/js/pages/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/resources/js/pages) |
| SSO and passkeys for customer users | No code here; the tables `external_identities`, `tenant_identity_providers`, `sso_login_attempts`, and `passkeys` exist only in the baseline | [`docs/dev/32-sso.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/32-sso.md) |

## Canonical sources

Read only what the task needs:

- `AGENTS.md`, sections "Konsol dan portal", "Aturan konsol, agen, dan rilis", "Kontrak", "Database", and "Repo ini
  publik".
- CoreERP [`docs/dev/31-admin-erp-control-plane.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/31-admin-erp-control-plane.md)
  — what the console is, its data boundary, both directions of conversation, audit, and the rules it enforces.
- CoreERP [`docs/dev/32-sso.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/32-sso.md) — the SSO
  ceremony, its guards, and its settings.
- CoreERP [`docs/dev/09-identity-and-access.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/09-identity-and-access.md)
  — when a tenant uses SSO, and the two kinds of invitation.
- Skill `control-plane-metta-release` — where releases and images come from.

The CoreERP pages describe CoreERP. For a part already ported, `AGENTS.md` and the code here win where they differ:
operators have their own table instead of being `users` rows, the session is a signed cookie without a session table,
2FA is asked on the SSO path too, and the control plane has its own database instead of tables migrated by Core.

## Invariants — never weaken these

1. **The control plane owns its schema, and CoreERP is not touched.** A schema change is a new file in
   `database/migrations/`, applied by `bun run migrate`. An applied migration never changes; its checksum is checked
   on every run. Improving CoreERP's schema follows the rule in `AGENTS.md`, section "Database".
2. **No direct reads across repositories.** The control plane never reads an environment's database, and
   operations-metta never reads this one. What an environment holds, such as installed modules or clinic users, comes
   from operations-metta's `internal/v1` contract.
3. **The site comes from the verified signature, never from the request body.** Reading `site_id` from the payload lets
   one site command another. In CoreERP, `VerifyAgentSignature` carries the verified site on a request attribute.
4. **Every mutating operator action writes one `operator_audit_events` row in the same transaction as the change**,
   through `recordAudit()`, which throws outside a transaction. An action with no operator, such as a CLI command or
   work triggered by an agent report, passes `operatorId: null`; this is CoreERP's `recordBySystem()`. `detail` records
   that a secret exists or changed, never its value. The table rejects `UPDATE` and `DELETE` through the trigger
   `operator_audit_events_hanya_tambah`.
5. **Secrets never travel as a command argument**, because `ps` and shell history keep it. CLI commands read them
   from stdin, as `create-operator` does with the password. Screens show fingerprints, never key material. Secrets at
   rest are encrypted with a key derived from `APP_KEY` per purpose (`SecretBox`); a new kind of secret gets its own
   purpose, so one purpose's ciphertext cannot be opened as another. CoreERP kept console secrets, such as the DNS
   token and the registry robot, encrypted in `console_settings`, written by commands that read stdin.
6. **Operator routes exist only in the console process.** They live in `*.console.routes.ts`, leave their area through
   `index.console.ts`, and are spread into `consoleRouter()` in `src/console.ts`; `bun run check:boundaries` rejects
   any other path into a process. Routes that need an operator are built on `operatorProcedure`, which checks the
   signed cookie and that the operator is still active and signed in after `sessions_valid_after`. Browser routes are
   built on `consoleBase` or `operatorProcedure`, which answer `415` to a mutating request that is not JSON; only a route
   called by another system, such as `POST /sso/backchannel-logout`, which receives a form from the SSO provider, uses
   `base`. Without a valid operator session the answer is `401`; the 404 rule in `AGENTS.md` applies once a
   non-operator account can hold a console session.
7. **SSO links on `iss` + `sub`, never on email.** Logging in never creates an operator. Linking requires the password
   to be typed again. Operator links live in `operator_identities`, never in `external_identities`, which belongs to
   customer users.
8. **The agent API contract is carried as it is.** Agents are already installed on client servers and speak CoreERP's
   [`openapi-agent.yaml`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/contracts/openapi-agent.yaml):
   the paths under `/api/agent/v1/` and `/api/releases/v1`, the RFC 9421 subset for signatures, and every request and
   response shape. It is copied by hand to `contracts/agent/`. A changed shape ships as a new API version, never in
   place.
9. **Agent-facing errors stay `{"error": "<code>"}`** with no explaining sentence. Throw
   `new HttpFailure(status, { error: '<code>' })`; `abort()` answers `{ message }` and is for console routes. A
   rejected signature is always `401` with `signature_invalid`, without saying which part failed.

## Open before porting the agent API

Installed agents received their site id at enrollment and their operation ids in claims as CoreERP ULIDs, 26
characters, and send them back as `keyid` and in paths and bodies. Here every id is a `uuid` with the same 128-bit
value; operations-metta converts with `ulid_to_uuid()` in its migration `0002_ids_to_uuid.sql`. How the agent API
accepts both forms is not decided. Ask the product owner before writing signature verification or operation routes,
and never reject the ULID form silently: that would cut off every installed agent.

## Places that must change together

| Change | Everything it touches |
| --- | --- |
| New console route | `*.console.routes.ts` in the feature folder → the area's `index.console.ts` → `consoleRouter()` in `src/console.ts` → a test at the same path under `test/` |
| New agent route | `*.agent.routes.ts` → the area's `index.agent.ts` → `agentRouter` in `src/agent.ts` → `contracts/agent/`, by hand → the agent. CoreERP's `contracts/check-contract-coverage.py` has no counterpart here yet, so nothing catches a route missing from the contract |
| New field in the agent report | The agent's report builder (`susun_laporan` in `deploy/agent/coreerp-agent`) → the server's list of accepted keys and their validation (CoreERP `SiteReports::TOP_LEVEL`) → the contract. The server rejects unknown keys, so it is deployed before the agents |
| New operation kind | A migration that widens the `site_operations_jenis_dikenal` CHECK → the code's list of kinds → the agent's `case` → the contract enum |
| New console setting | CoreERP's pattern in `LicenseTerms` and `RegistrySettings`: a reader that falls back to the environment, a settings screen field, and an audited writer; a secret setting is written by a CLI command that reads stdin |
| New audited action | `recordAudit()` inside `db.transaction()`. Name it `<subject>.<verb>`, like `operator.created`, `operator.two_factor_enabled`, and `sso.link`. `action` holds 60 characters and `subject_type` 40 |
| New environment variable | `environmentSchema` in `src/platform/config/index.ts` → the variable list in `README.md` → the deploy environment. Keep CoreERP's name when the console already had one, as `CONSOLE_SSO_*` does |
| Code ported from CoreERP | It checks what the CoreERP code checks; `oidc.ts` follows CoreERP's [`app/Sso/IdentityProvider.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Sso/IdentityProvider.php). A deliberate difference is written in `AGENTS.md`, as the 2FA on the SSO path is |

## Traps that already cost time

From CoreERP:

- **A fake that gives fixed answers makes both sides agree with each other.** Core once checked
  `Authorization: Bearer` while the console sent another header, and both suites stayed green. Validate requests
  against the contract file and prefer stateful fakes; `test/support/oidc-provider.ts` is a real HTTP server with its
  own RSA keys, not a patched `fetch`.
- **Guards must read what is really used.** A test-database guard that read the environment variable instead of the
  live connection could never go red, because the configuration pinned its own value.
- **Release numbers have three parts.** The console compared with PHP's `version_compare` while the agent strips a
  trailing `.0`, so `0.2` and `0.2.0` disagreed between them.
- **"Installed" and "entitled" are different questions.** Installed comes from the environment, over operations-metta's
  contract; entitlement is a record on this side. A CoreERP screen that swapped them showed an unpaid module as
  installed.
- **An answer from another repository is accepted only on exactly the expected status, and the tenant id in its body
  is compared.** In CoreERP a `202` read as an empty entitlement list issued a Core-only licence to a tenant that had
  bought everything.

From this repository:

- **postgres.js encodes a parameter bound to `jsonb` again**, storing a JSON string instead of an object. Pass the JSON
  text and cast `$n::text::jsonb`, as `recordAudit()` does.
- **`sql.unsafe()` does not prepare by default**, so every query is parsed and planned again. Go through `Database`
  (`rows`, `one`, `execute`, `transaction`), which passes `{ prepare: true }`.
- **A `SameSite=Strict` cookie is not sent on a navigation started by the SSO provider**, including its follow-up
  redirects. The callback answers a page that navigates by itself, so the session cookie rides along on the next page,
  and the ceremony cookie is `SameSite=Lax` with `Path=/sso`.
- **Our SSO provider returns no `nonce` in the code flow.** Its absence is accepted because PKCE already binds the code
  to the ceremony; a `nonce` that is present must match.
- **Session revocation uses the application clock, in milliseconds**, the same clock as `issuedAt` in the cookie. With
  the database's `now()`, skew between the two clocks could revive an old session or reject the next login; with whole
  seconds, a login right after logout could fall in the same second as the revocation.
- **Bun closes a connection after 10 idle seconds by default.** `serve()` sets `idleTimeout: 255` so slower requests
  are still answered.

## Testing

From the repository root:

```bash
bun run typecheck
bun test
bun run format:check
bun run check:boundaries
```

Tests that need PostgreSQL are skipped when `DB_HOST` is empty; CI always runs them against a migrated database. After
touching SQL, point `DB_*` at an empty database and run them there:

```bash
bun run migrate
bun test test/platform/operator-identity
```

`consoleTestApp()` in `test/support/console-app.ts` calls console routes with real `Request` objects, cookies, and a
client address. `OidcStub` in `test/support/oidc-provider.ts` is the SSO provider for tests.

## Before calling it done

- The four checks green, and the database tests run against an empty migrated database when SQL changed.
- A new migration applied twice to an empty database with `bun run migrate`; the second run prints
  `database is up to date`, as CI checks.
- `bun run build` when `package.json`, `bun.lock`, `tsconfig.json`, `Dockerfile`, or a process file in `src/` changed.
- The agent contract updated by hand when an agent route or shape changed, together with the calling side.
- Every new guard proven able to go red, following CoreERP's
  [`docs/dev/25-standar-penjaga-dan-pengujian.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/25-standar-penjaga-dan-pengujian.md).
- `AGENTS.md` or this skill updated in the same pull request when a rule changed, including a ported flow that
  deliberately behaves differently from CoreERP.
