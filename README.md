# control-plane-metta

Control plane untuk onboarding, trial gratis 30 hari Praktik Dokter, tenant, lingkungan, rilis, dan agen server. Repo ini berisi konsol operator internal, API agen, dan kelak portal customer. Ketiganya proses terpisah yang di-deploy terpisah, ditulis dengan Bun + Elysia.

## Status

Baru fondasinya: proses konsol (`src/console.ts`) dengan login operator, proses agen (`src/agent.ts`) yang baru menjawab `/up`, skema awal 24 tabel pusat di `database/migrations/`, dan pemeriksaan batas antarproses. Belum ada alur bisnis yang pindah dari konsol CoreERP.

## Menjalankan

```bash
bun install
bun run migrate
bun run start:console
bun run start:agent
```

Database dibaca dari `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, dan `DB_PASSWORD`. Host dan port proses dari `HOST` dan `PORT`. `APP_KEY` wajib berisi kunci 32 byte, misalnya `base64:` diikuti 32 byte acak dalam base64, untuk menandatangani sesi konsol. SSO operator menyala bila `CONSOLE_SSO_ISSUER`, `CONSOLE_SSO_CLIENT_ID`, `CONSOLE_SSO_CLIENT_SECRET`, dan `CONSOLE_SSO_REDIRECT_URI` diisi bersama. Kesalahan program (jawaban 500, kesalahan yang tidak tertangkap, dan kesalahan CLI) dikirim ke Sentry bila `SENTRY_DSN` diisi; `SENTRY_ENVIRONMENT` dan `SENTRY_RELEASE` opsional. Isi request, header, cookie, query, dan alamat IP tidak ikut terkirim.

Operator pertama dibuat dari CLI, dengan password lewat stdin:

```bash
read -rs PASSWORD && printf '%s' "$PASSWORD" | bun run cli create-operator --name "Nama Operator" --email operator@example.com
```

Runtime yang dijalankan untuk klinik ada di repo [operations-metta](https://github.com/MettaDevs/operations-metta). Aturan kerja di repo ini ada di [AGENTS.md](AGENTS.md).
