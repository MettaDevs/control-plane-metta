# control-plane-metta

Control plane untuk onboarding, trial gratis 30 hari Praktik Dokter, tenant, lingkungan, rilis, dan agen server. Repo ini berisi konsol operator internal, API agen, dan kelak portal customer. Ketiganya proses terpisah yang di-deploy terpisah, ditulis dengan Bun + Elysia.

## Status

Baru fondasinya: proses konsol (`src/console.ts`) dan agen (`src/agent.ts`) yang menjawab `/up`, skema awal 24 tabel pusat di `database/migrations/`, dan pemeriksaan batas antarproses. Belum ada alur bisnis yang pindah dari konsol CoreERP.

## Menjalankan

```bash
bun install
bun run migrate
bun run start:console
bun run start:agent
```

Database dibaca dari `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, dan `DB_PASSWORD`. Host dan port proses dari `HOST` dan `PORT`.

Runtime yang dijalankan untuk klinik ada di repo [operations-metta](https://github.com/MettaDevs/operations-metta). Aturan kerja di repo ini ada di [AGENTS.md](AGENTS.md).
