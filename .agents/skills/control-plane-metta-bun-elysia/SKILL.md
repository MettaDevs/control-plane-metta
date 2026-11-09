---
name: control-plane-metta-bun-elysia
description: Keep the measured Bun + Elysia runtime setup and database rules intact in operations-metta and control-plane-metta. Use when changing `src/main.ts`, `src/platform/database/`, `src/platform/identity/` sessions or Valkey, `src/platform/config/` (pool size, ports, session backend), prepared statements, parameter types, the audit actor, or PostgreSQL settings; when porting a CoreERP flow to TypeScript as an oRPC procedure; or when load-testing or quoting capacity numbers for the Bun stack.
---

# Bun + Elysia runtime and database rules

On 4 November 2026 the product owner chose Bun + Elysia for every new repository. There are two:
`operations-metta` (this repository: the runtime clinics use, SaaS and on-prem: ERP, then Praktik Dokter) and
`control-plane-metta` (onboarding, the Praktik Dokter trial, tenants, environments, releases and the server agent,
with an internal operator console and a customer portal deployed separately). Each repository's `AGENTS.md` holds
its own rules.

The decision, the measurements behind it, and their limits are in CoreERP's
[`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md).
Every `docs/...` path in this skill is in the CoreERP repository, which is frozen but stays readable. Read that page
before changing anything below. This skill only lists what an agent gets wrong without it.

## CoreERP stays the reference

The new code is a port, not a redesign. Screen, request, and data flows are described without any framework in
CoreERP's [`docs/design-system/`](https://github.com/MettaDevs/coreERP/tree/main/docs/design-system), including the
fidelity checklist in `04-pemeriksaan-kesetiaan.md`.

CoreERP's schema is the starting point, not a limit (owner decision, 9 November 2026). A change that makes it better,
such as a clearer name, a better column type, or a more useful index, is allowed when its reason is written in the PR,
it ships as a migration, the parity harness in `parity/` gets the old-to-new name mapping, and an API response shape
already in use changes only through a new API version. Tables that do not exist in CoreERP, such as Healthcare tables,
belong to this repository and its migrations from the start.

A ported flow is finished only when its HTTP responses, SQL writes (after that mapping), and SQL oracle results match
CoreERP for the same input, including revocation, rollback, and throttle cases (`parity/README.md`). Differences found
in CoreERP are reported to the owner to decide whether to copy or fix them; never fix them silently.

## Runtime setup that was measured

- One Bun process per core with `reusePort: true` (set in `src/main.ts`). One process runs JavaScript on one thread,
  so more cores without more processes adds nothing.
- Pool of 4 connections per process; one request reserves one connection until it finishes (`pool.reserve()` in
  `src/main.ts`). The pool size comes from `DB_POOL_SIZE` in `src/platform/config/index.ts`, whose default is 10, not
  the measured 4: set it explicitly per deployment. Check instances × processes × pool size against PostgreSQL
  `max_connections`.
- `idleTimeout: 255` in `src/main.ts`. Bun's 10-second default cuts slower requests.
- postgres.js `sql.unsafe(query, params, { prepare: true })`, as `Database.run` in `src/platform/database/index.ts`
  does. Without `prepare`, every query is parsed and planned again; prepared statements roughly halved database CPU
  per request.
- Container `nofile` 65536. The default soft limit of 1024 refuses connections near 1,000 sockets.
- Dates read as text (the `rawDate` type in `createPool`) and money as scaled `bigint` (`src/platform/money/`), so
  output matches CoreERP byte for byte.

## Database rules

- Number sequences only where people use the code (owner decision, 4 November 2026). The engine in
  `src/foundation/number-sequence/` stays as it is. Automatic numbers are for transaction documents and main masters
  searched by code, such as assets. Small setup masters get no number sequence: a short user-typed code like
  Business Central's `Code` field when people type or filter by it, otherwise only a name and an internal id. Decide
  per master when it is ported.
- Never cast a parameter to a type other than its column's: in CoreERP, `= any($1::text[])` against `char(26)` ids
  dropped the index. Ids here are `uuid`; bind them untyped or as `uuid`/`uuid[]`.
- Every commit costs one fsync. On a slow disk that is the ceiling, not CPU. Read requests write nothing unless they
  must; sessions can live in Valkey (`SESSION_BACKEND=valkey`, `src/platform/identity/valkey-sessions.ts`) as in
  [`docs/dev/36-cache-and-sessions.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/36-cache-and-sessions.md).
  Valkey `appendfsync always` moves the fsync rather than removing it — the choice is open and must be measured, not
  assumed.
- The audit actor is set with `set_config('coreerp.user_id', $1, false)` on the reserved connection (`Database.actor`)
  and cleared before the connection is released. Under PgBouncer transaction pooling it leaks to other users; with
  such a pooler, set it per transaction with `set_config(..., true)`.
- Forbidden: `fsync=off`, `full_page_writes=off`, unlogged tables for business data. `synchronous_commit = off` only via
  `SET LOCAL` for writes that may be lost on a crash — never posting, numbers, stock, or ledger.

## Capacity numbers

- No optimisation (Valkey sessions, context cache, PostgreSQL tuning) has been proven to raise the limit yet. Do not
  call any of them mandatory until an A/B run with clean correctness gates exists.
- Numbers from the lab virtual machine whose storage made fsync nearly free are not durable capacity. Production
  capacity must be measured on a server whose disk flushes durably.
- Load tests follow
  [`docs/dev/20-load-and-concurrency-testing.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/20-load-and-concurrency-testing.md)
  plus the measurement rules in the decision page: spread cycle starts over one cycle, warm up for one cycle, measure
  login separately, check host disk I/O, keep k6 labels free of ids, and repeat five times at the last pass and first
  fail. The working rules for running and profiling them are in `operations-metta-runtime-operations`.
