---
name: coreerp-bun-elysia
description: Carry the measured Bun + Elysia runtime setup and database rules into CoreERP's new repositories. Use when creating or changing a new Bun + Elysia repository for ERP, Praktik Dokter, or the control plane; when choosing process count, database pool, prepared statements, session store, or PostgreSQL settings for it; when porting a CoreERP flow to TypeScript; or when load-testing or quoting capacity numbers for the new stack.
---

# Bun + Elysia for CoreERP's new repositories

On 4 November 2026 the product owner chose Bun + Elysia for every new repository. There are two:
`operations-metta` (the runtime clinics use, SaaS and on-prem: ERP, then Praktik Dokter) and `control-plane-metta`
(onboarding, the Praktik Dokter trial, tenants, environments, releases and the server agent, with an internal operator
console and a customer portal deployed separately). Each repository's `AGENTS.md` holds its own rules.

The decision, the measurements behind it, and their limits are in CoreERP's `docs/dev/39-pindah-ke-bun-elysia.md`.
Every `docs/...` path in this skill is in the CoreERP repository. Read that page before changing anything below. This
skill only lists what an agent gets wrong without it.

## CoreERP stays the reference

The new code is a port, not a redesign. Screen, request, and data flows are described without any framework in
`docs/design-system/`, including the fidelity checklist in `04-pemeriksaan-kesetiaan.md`. Table and column names stay
1:1 with CoreERP. A ported flow is finished only
when its HTTP responses, SQL writes, and SQL oracle results match CoreERP for the same input, including revocation,
rollback, and throttle cases. Differences found in CoreERP are reported to the owner to decide whether to copy or fix
them; never fix them silently.

## Runtime setup that was measured

- One Bun process per core with `reusePort: true`. One process runs JavaScript on one thread, so more cores without
  more processes adds nothing.
- Pool of 4 connections per process; one request reserves one connection until it finishes. Check
  instances × processes × 4 against PostgreSQL `max_connections`.
- `idleTimeout: 255`. Bun's 10-second default cuts slower requests.
- postgres.js `sql.unsafe(query, params, { prepare: true })`. Without `prepare`, every query is parsed and planned again;
  prepared statements roughly halved database CPU per request.
- Container `nofile` 65536. The default soft limit of 1024 refuses connections near 1,000 sockets.
- Dates read as text and money as scaled `bigint`, so output matches CoreERP byte for byte.

## Database rules

- Number sequences only where people use the code (owner decision, 4 November 2026). The engine stays as it is.
  Automatic numbers are for transaction documents and main masters searched by code, such as assets. Small setup
  masters get no number sequence: a short user-typed code like Business Central's `Code` field when people type or
  filter by it, otherwise only a name and an internal id. Decide per master when it is ported.
- Never cast a parameter to a type other than its column's: `= any($1::text[])` against `char(26)` ids drops the index.
- Every commit costs one fsync. On a slow disk that is the ceiling, not CPU. Read requests write nothing unless they
  must; sessions live in Valkey as in `docs/dev/36-cache-and-sessions.md`. Valkey `appendfsync always` moves the fsync
  rather than removing it — the choice is open and must be measured, not assumed.
- The audit actor is set with `set_config('coreerp.user_id', $1, false)` on the reserved connection. Under PgBouncer
  transaction pooling it leaks to other users; with such a pooler, set it per transaction with `set_config(..., true)`.
- Forbidden: `fsync=off`, `full_page_writes=off`, unlogged tables for business data. `synchronous_commit = off` only via
  `SET LOCAL` for writes that may be lost on a crash — never posting, numbers, stock, or ledger.

## Capacity numbers

- No optimisation (Valkey sessions, context cache, PostgreSQL tuning) has been proven to raise the limit yet. Do not
  call any of them mandatory until an A/B run with clean correctness gates exists.
- Numbers from the Cue machine assume near-free fsync and are not durable capacity. Production capacity must be
  measured on a server whose disk flushes durably.
- Load tests follow `docs/dev/20-load-and-concurrency-testing.md` plus the measurement rules in the decision page:
  spread cycle starts over one cycle, warm up for one cycle, measure login separately, check host disk I/O, keep k6
  labels free of ids, and repeat five times at the last pass and first fail.
