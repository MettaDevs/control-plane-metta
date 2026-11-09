---
name: control-plane-metta-release
description: Rules and measured traps for the release path of control-plane-metta — release numbers, release registration, the Harbor registry and its robots, registry credentials handed to the server agent, the release assembler, deploys to SaaS dev, and image pulls on managed client servers. None of that code has moved from CoreERP yet. Use when building or porting anything under `src/releases/`, the release-registration or registry-credential routes of the agent API, a release workflow, Harbor setup, or the agent's image pull and tag logic; and when cutting a release, rotating a robot, or debugging a failed push or pull.
---

# control-plane-metta releases and Harbor

One image per release is built once, pushed to Harbor, deployed to SaaS dev by digest, and pulled by the agent on
client servers with the same digest. Merging to `main` deploys nothing.

This skill moved here from CoreERP's `coreerp-harbor` on 9 November 2026. **None of the release code has moved yet.**
`AGENTS.md` places the release registry and Harbor in `src/releases/` and the release pipeline in the agent process
(`src/agent.ts`); the tables `site_releases` and `site_operations.registry_robot_*` already exist in
`database/migrations/0001_baseline.sql`. The release assembler, the Harbor setup scripts, and the server agent have no
place in the "Susunan repo" table yet: ask the product owner before creating one. Until the code is ported, CoreERP is
the behaviour reference, and the CoreERP repository is no longer changed.

## Behaviour reference in CoreERP

| Part | Code |
| --- | --- |
| Release assembler and its sudo wrapper | [`deploy/perakit/`](https://github.com/MettaDevs/coreERP/tree/main/deploy/perakit) |
| Harbor setup, smoke test, measurements, runbook | [`deploy/registry/`](https://github.com/MettaDevs/coreERP/tree/main/deploy/registry) |
| Release and SaaS dev workflows | [`.github/workflows/rilis.yml`](https://github.com/MettaDevs/coreERP/blob/main/.github/workflows/rilis.yml), [`deploy-dev.yml`](https://github.com/MettaDevs/coreERP/blob/main/.github/workflows/deploy-dev.yml), [`deploy/saas/pasang-rilis.sh`](https://github.com/MettaDevs/coreERP/blob/main/deploy/saas/pasang-rilis.sh) |
| Console side: Harbor client, per-operation credentials, registry settings | [`apps/control-plane/app/Registry/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/app/Registry) |
| Release registration and manifest v2 | [`ReleaseRegistry.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Sites/ReleaseRegistry.php), [`RegisterRelease.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/app/Http/Controllers/Releases/RegisterRelease.php) |
| Agent API contract, including `RegistryCredential` and `/releases/v1` | [`openapi-agent.yaml`](https://github.com/MettaDevs/coreERP/blob/main/apps/control-plane/contracts/openapi-agent.yaml) |
| Pull and tag on client servers | [`deploy/agent/coreerp-agent`](https://github.com/MettaDevs/coreERP/blob/main/deploy/agent/coreerp-agent), [`scripts/update.sh`](https://github.com/MettaDevs/coreERP/blob/main/scripts/update.sh), [`deploy/compose.edition.yaml`](https://github.com/MettaDevs/coreERP/blob/main/deploy/compose.edition.yaml) |

## Canonical sources

Read the section you need; do not restate it from memory:

- [`docs/dev/29-alur-rilis-server-klien.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/29-alur-rilis-server-klien.md)
  — the flow from merge to client server, who holds which secret, and how a release number is chosen.
- [`docs/dev/30-registry-harbor.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/30-registry-harbor.md)
  — what Harbor holds, the robots, per-operation credentials, the pull sequence, immutability, retention, GC, and the
  measured traps.
- [`deploy/registry/SPIKE.md`](https://github.com/MettaDevs/coreERP/blob/main/deploy/registry/SPIKE.md) — the
  measurements behind almost every rule. Prefer it over Harbor's own documentation when they disagree; it measured the
  Harbor version in use.
- [`deploy/registry/RUNBOOK.md`](https://github.com/MettaDevs/coreERP/blob/main/deploy/registry/RUNBOOK.md) —
  operator procedures, each marked tested or untested.
- [`deploy/perakit/README.md`](https://github.com/MettaDevs/coreERP/blob/main/deploy/perakit/README.md) — the
  assembler, the sudo wrapper, and its installer.
- [`docs/todo/registry-harbor/README.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/registry-harbor/README.md)
  — the PRD and its open decisions.
- `AGENTS.md`, sections "Aturan konsol, agen, dan rilis", "Kontrak", and "Repo ini publik".

## Invariants — never weaken these

- **Clients pull digests, never tags.** The digest sits in a manifest signed by the release key, which no robot holds.
  A stolen push robot must not be able to make a client run another image.
- **Compose on servers never pulls.** Every service keeps `pull_policy: never` and refers only to the release image
  variable or a local tag. A missing local tag must fail, not fall back to Docker Hub, where anyone can register a
  name and nothing checks a signature.
- **No registry host is stored on a client server.** Host and credentials arrive with each operation.
- **One pull-only robot per operation, not per site.** It is created when the agent asks, recorded on the operation row
  (`site_operations.registry_robot_id` and `registry_robot_name`), and deleted by a sweep once the operation is no
  longer held. A secret left behind on a client server dies with its operation.
- **Nothing gets a local tag until every image has matched its `RepoDigests`.** A rejected pull must not overwrite the
  tag a rollback depends on.
- **Secrets are never printed** — not to terminals, logs, conversations, command arguments, or audit detail. Pass them
  through 0600 files and stdin. Run CLI commands inside a container as the application user, never as root.
- **No human password accounts in Harbor.** Harbor accepts basic auth on `/v2/`, which bypasses the token rate limit.
- **Only the assembler pushes, from a fast server.** Do not change SSH, firewall, or static reverse-proxy settings,
  including Traefik's 60-second `readTimeout`, without the product owner's approval.
- **Immutability stays on and retention stays unscheduled** until release tags for installed versions exist (CoreERP
  TODO CP-05). An artifact with an immutable tag cannot be deleted by retention.
- **Release numbers have three parts and only move forward on client servers.** One number has one content; a used
  number is never reused, and a burned number costs nothing. Rolling back on a client server happens only inside the
  update script when an update fails.
- **A migration stays usable by the previous release's code**, because a rollback runs the previous image against the
  same database.
- **The workflow follows the public-repository rules in `AGENTS.md`.** CoreERP's release workflow runs on a
  GitHub-hosted runner and reaches the build server over SSH, with host, user, key, and known hosts in GitHub Actions
  secrets, and a sudo rule that allows exactly one command. Never a self-hosted runner, never on `pull_request`.

## Places that must change together

| Rule | Where CoreERP writes it |
| --- | --- |
| Local tag names (release image tagged with the release number, companion images with the first 20 hex characters of their digest) | The agent, `scripts/update.sh`, and the compose rewrite in `deploy/perakit/rakit.sh` |
| GC schedule | `CRON_GC` in `deploy/registry/atur-harbor.sh`, and `GC_HARI_UTC`/`GC_JAM_UTC` in `rakit.sh`, which refuses to push in the hour around it |
| Manifest v2 shape | `rakit.sh`, `ReleaseRegistry::fromManifestV2()`, and the agent's manifest reader |
| Install and upgrade operation parameters, and the credential endpoint | The agent API contract, `AgentApi`, and the agent |
| Companion images | Literal `image:` lines in `deploy/compose.edition.yaml`; adding one there adds a companion to the next release |

Nothing mechanical catches a drift between these. Change them in the same pull request and say so in its description.
Installed agents already use these local tag names.

## Cutting and verifying a release

Until the release code moves, the procedure is CoreERP's, in docs/dev/29, section "Tahap demi tahap". The rules
below hold wherever it runs.

1. Pick the number: three parts, no leading zeros, no suffix. Bump MINOR if any migration changed since the previous
   release, PATCH otherwise; a PATCH never carries a migration. The check command and its pathspec trap are in
   docs/dev/29, section "Angka mana yang dinaikkan".
2. Verify, do not assume:
   - every workflow job green;
   - the assembler's log for the release ends with the release registered;
   - the running SaaS dev containers resolve (`RepoDigests`) to the digests recorded for the release, including every
     third-party image, which must come from our Harbor project, never from Docker Hub;
   - the released application's `/up` answers 200 from inside the console's network, and the console answers too;
   - the release appears in `site_releases`.

## Measured traps

| Symptom | Cause |
| --- | --- |
| `/v2/` answers 401 **without** `Www-Authenticate`; `docker login` fails oddly | Harbor's proxy nginx cached the old address of its `core` service; restart the proxy |
| A credential check passes with a wrong password | Harbor answers anonymous requests to `GET /projects` with `200 []`; check that the project is in the body |
| The assembler pushed a number that already existed | A failed tag read was treated as "absent". Only `NOT_FOUND`, `MANIFEST_UNKNOWN`, and `NAME_UNKNOWN` mean absent; run `crane` with the caller's uid |
| A pull still works minutes after its robot was deleted | Issued tokens live for the token lifetime plus about 60 seconds |
| A large layer push dies at exactly 60 seconds | Traefik's `readTimeout`; push from the fast server |
| `.Id` of a pulled image does not match the digest | `.Id` is the config digest on the classic image store and the manifest digest on containerd; compare `RepoDigests` |
| The console cannot create a pull-only site robot | Harbor refuses a robot that creates a robot with more permission than its own, so the console's system robot needs pull although it never pulls |
| A site robot's secret cannot be rotated | Harbor has no `robot:update` permission; a repeated request deletes the old robot and creates a new one |

## Testing changes

Nothing here tests the release path yet. In CoreERP:

- Console credentials and release registration: `RegistryCredentialTest`, `ReleaseRegistrationTest`, and the registry
  part of `SettingsScreenTest` under
  [`apps/control-plane/tests/Feature/Sites/`](https://github.com/MettaDevs/coreERP/tree/main/apps/control-plane/tests/Feature/Sites).
- Agent pulls: `deploy/agent/tests/run-tests.sh` in an `ubuntu:24.04` container; on Git Bash for Windows, mount
  `$(pwd -W)` with `MSYS_NO_PATHCONV=1`.
- Harbor from outside: `deploy/registry/uji-asap.sh` on the Harbor server.
- The assembler has no automated suite. A change is proven by cutting a real test release and reading its log.

When the code moves here, port those tests with it. A fake Harbor that only returns canned answers proves the code
calls the URL it expects, not that the sequence works. Shape fakes on measured responses, keep state across calls when
the code reads before it writes, and prove each new guard can fail by mutating the code once.

## Before calling it done

- The invariants above still hold, and every place in "Places that must change together" moved together.
- The four checks in `AGENTS.md`, section "Sebelum menyatakan hijau", green.
- `AGENTS.md` or this skill describes any rule that changed. A runbook procedure is marked tested only if it was run to
  completion on the server.
- No secret, token, password, server address, or SSH user appears in the diff, the commit message, test output you
  paste, or the conversation. This repository is public; use `registry.example.com` and `203.0.113.10` in examples.
