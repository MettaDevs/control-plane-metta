# control-plane-metta

- Repo ini adalah control plane kami untuk onboarding, trial gratis 30 hari Praktik Dokter, tenant, lingkungan, rilis, dan agen server. Di dalamnya akan ada konsol operator internal dan, menyusul kemudian, portal customer. Keduanya di-deploy terpisah.
- Yang sudah ada baru fondasinya: proses konsol dengan login operator, proses agen yang baru menjawab `/up`, skema awal tabel pusat, dan pemeriksaan batas. Belum ada alur bisnis yang pindah.
- Runtime yang dijalankan untuk klinik, yaitu ERP dan Praktik Dokter, milik repo [operations-metta](https://github.com/MettaDevs/operations-metta).
- Untuk alur yang sudah ada di konsol operator CoreERP (`apps/control-plane`, alamatnya admin.erp), CoreERP tetap acuan perilaku sampai alur itu selesai dipindah. Aturan konsol itu ada di skill [`coreerp-konsol`](https://github.com/MettaDevs/coreERP/blob/main/.agents/skills/coreerp-konsol/SKILL.md), [`docs/dev/31-admin-erp-control-plane.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/31-admin-erp-control-plane.md), dan [`docs/dev/32-sso.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/32-sso.md).
- Jaga perubahan dan dependency tetap minimal. Jangan membuat abstraksi atau compatibility layer spekulatif. Kalau ada yang membingungkan, tanyakan langsung ke pemilik produk dan berhenti dulu sampai konteksnya jelas.
- SaaS dikelola lewat control plane. On-prem perpetual berdiri sendiri, memakai update bertanda tangan, dan tidak mewajibkan telemetry.

## Susunan repo

Keputusan pemilik produk, 9 November 2026: susunan folder mengikuti pola operations-metta, yang mengikuti Business Central. Folder disusun per area lalu per fitur, bukan per jenis teknis, dan semua berkas satu fitur ada di satu folder.

Repo ini tumbuh dengan menambah folder dan berkas di tempat yang sudah ditetapkan tabel berikut, tanpa menyusun ulang yang sudah ada. Kalau sesuatu yang baru tidak punya tempat di tabel, tanyakan ke pemilik produk sebelum membuat tempat baru.

| Yang bertambah | Tempatnya | Contoh |
| --- | --- | --- |
| Proses yang di-deploy | Satu berkas di akar `src/` | `src/console.ts` untuk operator, `src/agent.ts` untuk agen server dan pipeline rilis. Nanti `src/portal.ts` untuk customer dan `src/worker.ts` |
| Kemampuan bersama | `src/platform/<kemampuan>/` dengan `index.ts` | `src/platform/database/`, nanti `src/platform/operator-identity/` |
| Area bisnis, lalu fitur | `src/<area>/<fitur>/` | `src/environments/provision/`, `src/sites/enrollment/` |
| Peran berkas | Akhiran `.schema.ts`, `.service.ts`, `.routes.ts`, `.test.ts`, dan nanti `.page.tsx` | `environment.service.ts` |
| Pemanggil route atau layar | `.console.routes.ts`, `.agent.routes.ts`, `.portal.routes.ts`, dan `.console.page.tsx` | `site.agent.routes.ts` |
| Pintu area per pemanggil | `index.ts` untuk layanan bersama, `index.<pemanggil>.ts` untuk route satu pemanggil | `src/sites/index.agent.ts` |
| Migration | `database/migrations/` | `0001_baseline.sql` |
| Kontrak | `contracts/agent/` untuk API agen, `contracts/onboarding/` untuk API onboarding | `contracts/agent/openapi.yaml` |
| Layar | `.page.tsx` di folder fitur. Bingkai layar (layout, menu, login) di `src/platform/shell/` | `environment.console.page.tsx` |

- Area yang direncanakan: `customers` (customer, registri tenant, entitlement), `environments` (registri, operasi dengan lease, runner, provisioning, upgrade, salin, pembersihan), `sites` (server klien: enrollment, antrean operasi, laporan, lisensi), `releases` (registri rilis, Harbor), `settings` (setelan konsol, DNS), dan `products` (tenant produk lama selama masih dipakai).
- Setiap proses memuat router untuk pemanggilnya sendiri lewat `serve()` di `src/platform/http/`. Route yang tidak ada di router itu tidak bisa dijangkau dari prosesnya, jadi rute operator tidak pernah ada di proses yang terbuka untuk customer atau agen.
- `index.ts` adalah satu-satunya pintu publik sebuah kemampuan atau area untuk layanan bersama. Route satu pemanggil keluar lewat `index.<pemanggil>.ts`, supaya proses lain bisa memakai layanan area itu tanpa ikut memuat route-nya. Berkas di dalam satu folder boleh saling meng-import langsung.
- Aturan bisnis yang dipakai beberapa pemanggil ada di `.service.ts`, yang namanya tidak membawa pemanggil.
- Test diletakkan di samping berkas yang diujinya. Tidak ada folder `test/` terpisah.
- Framework UI boleh dipilih belakangan. Tempat layar tidak berubah karena pilihan itu.
- `bun run check:boundaries` menolak impor yang melewati pintu sebuah kemampuan atau area, berkas satu pemanggil yang meng-import berkas pemanggil lain, proses yang memuat berkas pemanggil lain di mana pun di rantai impornya, proses tanpa pemanggil (misalnya `worker.ts`) yang memuat route, dan kode selain test yang meng-import berkas proses.

## Konsol dan portal

- Konsol dan portal di-deploy terpisah, masing-masing dengan host dan login sendiri. Konsol memakai SSO operator. Portal memakai akun customer.
- Rute operator tidak bisa dijangkau dari host portal. Di konsol, yang bukan operator mendapat 404, bukan 403, karena 403 memberi tahu bahwa alamat itu ada.
- Konsol dan portal memanggil layanan onboarding yang sama. Dari portal, customer tidak bisa memilih apa yang hanya boleh dipilih operator, misalnya owner, database, rilis, akun dukungan, dan tenggat.
- Pengelolaan pengguna dan role di dalam tenant milik operations-metta, bukan konsol atau portal.
- SSO operator menautkan identitas lewat `iss` dan `sub`, tidak pernah lewat email. Login SSO tidak pernah membuat akun operator.
- Operator punya tabel `operators` sendiri, terpisah dari `users` milik customer (keputusan pemilik produk, 9 November 2026). Karena tidak ada akun customer yang bisa login di konsol, request tanpa sesi operator yang sah mendapat 401. Aturan 404 di atas berlaku bila kelak ada akun selain operator yang bisa memegang sesi konsol.
- Operator baru dibuat dengan `bun src/cli.ts create-operator --name <nama> --email <email>` (di container: `bun dist/cli.js ...`). Password dikirim lewat stdin. Perintah ini menulis `operator.created` ke jejak audit.
- Sesi konsol adalah cookie `HttpOnly`, `SameSite=Strict`, yang ditandatangani HMAC-SHA256 dengan `APP_KEY`; tidak ada tabel sesi. Logout mengisi `operators.sessions_valid_after`, sehingga semua sesi operator itu berakhir, termasuk di perangkat lain. Request yang mengubah sesuatu wajib `Content-Type: application/json`, supaya form dari situs lain tidak bisa mengirimnya.
- Login yang gagal dibatasi lima kali per menit untuk setiap pasangan email dan alamat IP. Hitungannya ada di tabel `rate_limits`, jadi berlaku sama di semua proses.
- Jejak audit ditulis dengan `recordAudit()` dari `src/platform/audit/`. Fungsi itu menolak berjalan di luar transaksi, supaya baris audit selalu ikut transaksi perubahannya.

## Aturan konsol, agen, dan rilis

- Konsol mengelola tenant, lingkungan, dan rilis.
- Konsol hanya boleh membuka data bisnis klinik lewat akses yang punya tenggat dan tercatat di jejak audit.
- Setiap tindakan operator yang mengubah sesuatu menulis satu baris `operator_audit_events` di transaksi yang sama dengan perubahannya. Isinya tidak pernah memuat nilai rahasia.
- Secret tidak pernah dikirim sebagai argumen perintah, karena argumen terbaca `ps` dan tersimpan di riwayat shell. Layar menampilkan sidik jari kunci, tidak pernah isinya.
- Situs, yaitu server klien tempat agen berjalan, ditentukan dari signature permintaan yang sudah diverifikasi, tidak pernah dari body. Membaca `site_id` dari body membuat satu situs bisa memerintah situs lain.
- Katalog, entitlement, dan pemasangan module tidak sama. Katalog berarti produk dikenal, entitlement berarti tenant berhak memakai, dan `installed` hanya sah setelah migration module berhasil dan tercatat di `core_module_installations`. Layar berlabel "terpasang" membaca catatan pemasangan itu, tidak menyimpulkannya dari entitlement. Di CoreERP, layar yang menukar keduanya pernah menampilkan module yang belum dibeli sebagai terpasang.
- Nomor rilis selalu tiga bagian, misalnya `0.2.0`, bukan `0.2`. Konsol dan agen CoreERP pernah tidak sepakat apakah `0.2` sama dengan `0.2.0`.

## Kontrak

- Repo ini pemilik kontrak API agen dan API onboarding. operations-metta pemilik endpoint `internal/v1` yang dipanggil control plane.
- Kontrak ditulis tangan, tidak pernah di-generate dari kode.
- REST untuk perintah dan permintaan data. Event untuk fakta yang sudah terjadi. Jangan mengontrakkan panggilan REST sebagai event, atau sebaliknya.
- Kontrak menggambarkan keadaan sebenarnya. Kalau kode belum memenuhi aturan, tulis gap-nya di `info.description`, bukan bentuk ideal yang belum dikirim kode.
- Mengubah kontrak berarti mengubah repo penerbit dan repo pemanggil dalam pekerjaan yang sama.
- Test sisi pemanggil memvalidasi permintaannya terhadap berkas kontrak, bukan terhadap fake berjawaban tetap. Di CoreERP, Core memeriksa `Authorization: Bearer`, konsol mengirim header lain, dan kedua suite tetap hijau.

## Database

- Control plane punya database dan migration sendiri, terpisah dari database operations-metta. Repo ini tidak pernah membaca database lingkungan, dan operations-metta tidak pernah membaca database ini. Keduanya bertukar data hanya lewat kontrak.
- `database/migrations/0001_baseline.sql` adalah 24 tabel sisi pusat CoreERP pada commit `6b3cf584`, sesudah id ULID dan id pengguna menjadi `uuid`. Daftar tabelnya `modelSisiPusat()` pada [`apps/core/tests/Feature/Boundary/BatasPusatTest.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/core/tests/Feature/Boundary/BatasPusatTest.php), ditambah `external_identities`, `passkeys`, dan `sso_login_attempts`. Perubahannya dari CoreERP ditulis di kepala berkas itu.
- `bun run migrate` menjalankan migration yang belum tercatat di `schema_migrations`, berurutan, masing-masing dalam satu transaksi. Migration yang sudah dijalankan tidak boleh diubah; checksum-nya diperiksa setiap kali.
- Id baru dibuat dengan `Bun.randomUUIDv7()`. API dan URL memakai teks UUID huruf kecil.
- Skema CoreERP adalah titik awal, bukan batas. Keputusan pemilik produk 9 November 2026: perubahan yang membuat skema lebih baik boleh dilakukan, misalnya nama yang lebih jelas, tipe kolom yang lebih tepat, atau index yang lebih berguna. Setiap perubahan:
  - alasannya ditulis di PR-nya;
  - dikerjakan lewat migration, tidak pernah diubah tangan di database;
  - ikut memperbarui harness kesetaraan, termasuk pemetaan nama lama ke nama baru;
  - tidak mengubah bentuk respons API yang sudah dipakai. Bentuk baru dirilis sebagai versi API baru.
- Repo CoreERP tidak disentuh lagi (keputusan pemilik produk, 9 November 2026). Perubahan tabel pusat dan tabel baru, misalnya trial dan langganan dari portal, ditulis sebagai migration di repo ini.
- operations-metta masih membawa salinan tabel pusat di skemanya sampai datanya dipindah ke sini dan tabel itu dicabut dari sana. Salinan itu tidak ikut diubah, jadi kode operations-metta tidak boleh mulai bergantung pada tabel pusat.
- Production di server kami bawaannya memakai database sendiri, sama seperti demo dan sandbox. Database bersama yang dipisah `tenant_id` tetap ada sebagai pilihan paket termurah. Tidak ada schema per tenant. Ini keputusan pemilik produk pada 24 September 2026.
- Konfigurasi runtime dan aturan database ditetapkan skill `coreerp-bun-elysia` dan [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md). Berkas ini sengaja tidak menyalin angkanya. Baca dari sumbernya.
- Tidak ada baris yang dihapus fisik. Menghapus berarti mengisi `deleted_at`. Indeks unik pada kode bisnis wajib parsial (`WHERE deleted_at IS NULL`), supaya kode yang sudah dihapus bisa dipakai lagi. Rinciannya di [Penghapusan lunak](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#penghapusan-lunak).

## Bahasa

- **Nama di dalam kode ditulis bahasa Inggris, tanpa kecuali.** Ini berlaku untuk berkas, folder, fungsi, class, type, variabel, properti, nama route, kunci config, variabel env, nama perintah CLI, dan komponen UI. Contohnya, `siapkanLingkungan` menjadi `provisionEnvironment`.
- Yang tetap bahasa Indonesia, dan ini disengaja: nama tabel, kolom, index, dan constraint database, teks yang dibaca pengguna di layar, alamat URL layar yang diketik operator, komentar, docs, dan pesan commit.
- Kalau sebuah istilah tidak punya padanan Inggris yang jelas, pakai istilah Dynamics 365 untuk hal yang sama. Jangan mengarang terjemahan harfiah.
- Istilah teknis yang sudah baku ditulis apa adanya, misalnya push, pull, scope, token, signing secret, webhook, endpoint, GET, POST, dan PUT. Ini berlaku di layar, pesan, kontrak, dan docs. Tulis "scope `vendors.read`", bukan "cakupan `vendors.read`". Batasnya ada di skill `coreerp-docs` CoreERP, bagian [Where the loanword boundary sits](https://github.com/MettaDevs/coreERP/blob/main/.agents/skills/coreerp-docs/SKILL.md#where-the-loanword-boundary-sits).
- Teks layar untuk pengguna bisnis memakai bahasa sehari-hari yang menjelaskan tindakan atau dampaknya. Istilah internal seperti `tenant_id`, entitlement, atau nama class tidak tampil di layar itu. Pengecualiannya hanya layar yang memang untuk developer atau operator teknis.

## Nama datang dari database

- Jangan menulis mati nama perusahaan, nama orang, atau nama module besar seperti Praktik Dokter di kode. Nama itu datang dari konfigurasi di database. Kalau belum jelas sebuah nama termasuk atau tidak, tanyakan ke pemilik produk.

## Repo ini publik

Siapa pun bisa membaca isi repo ini, termasuk berkas yang sudah dihapus, karena riwayat git menyimpannya.

- Tidak ada secret di repo. Secret hanya disimpan di GitHub Actions secrets.
- Tidak ada data pasien. Fixture dan data uji dibuat sintetis.
- Alamat server, IP, user SSH, dan nama service di server ditulis sebagai contoh, misalnya `server.example.com` dan `203.0.113.10`, bukan nilai sebenarnya.
- Tidak ada self-hosted runner. Pull request dari fork dapat menjalankan kode apa pun di runner semacam itu.
- Workflow deploy hanya berjalan di `main` atau tag, tidak pernah pada event `pull_request`.

## Skill

- Setiap skill ada di `.agents/skills/` dan `.claude/skills/` dengan isi yang sama persis, karena kedua folder dibaca alat yang berbeda. Ubah keduanya dalam commit yang sama.
- `coreerp-bun-elysia` disalin apa adanya dari CoreERP. Path `docs/...` di dalamnya menunjuk ke repo CoreERP. Bila skill itu berubah di CoreERP, salin ulang ke kedua folder di sini.

## Alur kerja

Keputusan pemilik produk, 9 November 2026: setiap perubahan masuk `main` lewat pull request, supaya CI selalu lulus sebelum perubahan sampai di `main`. PR tidak dibuat sebagai draft dan tidak menunggu review.

- Kerjakan di worktree sendiri, lalu jalankan pemeriksaan di bagian [Sebelum menyatakan hijau](#sebelum-menyatakan-hijau).
- Push branch-nya dan langsung buka PR biasa: `gh pr create --base main`. Jangan `--draft`.
- Langsung pasang auto-merge: `gh pr merge --auto --squash`. GitHub me-merge PR itu sendiri begitu check `check` hijau. CI yang merah diperbaiki di branch yang sama.
- Branch `main` dijaga ruleset GitHub: setiap perubahan wajib lewat PR, check `check` wajib lulus, dan force push serta penghapusan `main` ditolak. Push langsung ke `main` ditolak, juga untuk admin.
- **Hotfix.** Admin repo boleh me-merge PR tanpa menunggu CI dengan `gh pr merge --admin --squash`. Jalan ini hanya dipakai bila pemilik produk menyatakan perubahannya hotfix. Tulis "Hotfix" beserta alasannya di judul atau badan PR. Bila CI PR itu ternyata merah, perbaikannya menjadi PR berikutnya sebelum pekerjaan lain dilanjutkan.
- Jangan mematikan ruleset untuk meloloskan perubahan.

## Worktree

Keputusan pemilik produk, 9 November 2026: worktree tidak dibuat di folder kerja di luar repo, supaya folder kerja tidak dipenuhi salinan repo yang lupa dihapus.

- Worktree hanya dibuat di `.worktrees/<nama>` di dalam clone ini: `git worktree add .worktrees/<nama> -b <branch> origin/main`. Folder `.worktrees/` sudah di-ignore git.
- Hapus begitu PR-nya di-merge: `git worktree remove .worktrees/<nama>`, lalu `git branch -D <branch>`. Jangan menghapus foldernya dengan `rm -rf`.
- `bun scripts/prune-worktrees.ts`, dijalankan dari clone utama, menghapus worktree di `.worktrees/` yang commit-nya sudah ada di `main` dan HEAD-nya tidak bergerak 24 jam, atau yang PR-nya sudah di-merge atau ditutup, beserta branch lokalnya. Worktree yang masih punya perubahan belum di-commit atau commit yang belum masuk `main` tidak disentuh. Tambahkan `--dry-run` untuk melihat hasilnya tanpa menghapus apa pun.
- Setiap worktree yang dibiarkan dilaporkan tertinggal berapa commit dari `main` dan sudah berapa hari tidak disentuh, dengan tanda `LAMA` sesudah tujuh hari. Jalankan perintah itu di awal setiap sesi, dan putuskan worktree `LAMA` saat itu juga.
- Nama foldernya harus tetap berawalan titik. Prettier mengabaikannya karena tercantum di `.gitignore`, `bun test` tidak masuk ke folder berawalan titik, dan `tsconfig.json` hanya membaca folder yang disebut.

## Sebelum menyatakan hijau

Jalankan dari akar repo. Keempat pemeriksaan ini wajib lulus untuk setiap perubahan:

```bash
bun run typecheck
bun test
bun run format:check
bun run check:boundaries
```

Test yang membutuhkan database dilewati bila `DB_HOST` kosong. CI selalu menjalankannya terhadap database yang sudah dimigrasi. Sebelum menyatakan perubahan yang menyentuh SQL hijau, jalankan juga test itu terhadap database kosong yang sudah dimigrasi, dengan `DB_*` mengarah ke sana.

`bun run build` hanya perlu dijalankan bila perubahan menyentuh hasil build: `package.json`, `bun.lock`, `tsconfig.json`, `Dockerfile`, atau berkas proses di akar `src/`. CI tetap menjalankannya di setiap PR, bersama `bun run migrate` atas database kosong dua kali: sekali untuk menerapkan, sekali untuk memastikan tidak ada yang tersisa.
