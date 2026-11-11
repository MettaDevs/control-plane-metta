# control-plane-metta

- Repo ini adalah control plane kami untuk onboarding, trial gratis 30 hari Praktik Dokter, tenant, lingkungan, rilis, dan agen server. Di dalamnya ada konsol operator internal dan portal klien. Keduanya di-deploy terpisah.
- Yang sudah ada baru fondasinya: proses konsol dengan login operator dan layar pertamanya (login, daftar customer, customer baru), proses agen, skema awal tabel pusat, dan pemeriksaan batas.
- Runtime yang dijalankan untuk klinik, yaitu ERP dan Praktik Dokter, milik repo [operations-metta](https://github.com/MettaDevs/operations-metta).
- Untuk alur yang sudah ada di konsol operator CoreERP (`apps/control-plane`, alamatnya admin.erp), CoreERP tetap acuan perilaku sampai alur itu selesai dipindah. Aturan konsol itu ada di skill [`control-plane-metta-console`](.agents/skills/control-plane-metta-console/SKILL.md), [`docs/dev/31-admin-erp-control-plane.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/31-admin-erp-control-plane.md), dan [`docs/dev/32-sso.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/32-sso.md).
- Jaga perubahan dan dependency tetap minimal. Jangan membuat abstraksi atau compatibility layer spekulatif. Kalau ada yang membingungkan, tanyakan langsung ke pemilik produk dan berhenti dulu sampai konteksnya jelas.
- SaaS dikelola lewat control plane. On-prem perpetual berdiri sendiri, memakai update bertanda tangan, dan tidak mewajibkan telemetry.

## Susunan repo

Keputusan pemilik produk, 9 November 2026: susunan folder mengikuti pola operations-metta, yang mengikuti Business Central. Folder disusun per area lalu per fitur, bukan per jenis teknis, dan semua berkas satu fitur ada di satu folder.

Repo ini tumbuh dengan menambah folder dan berkas di tempat yang sudah ditetapkan tabel berikut, tanpa menyusun ulang yang sudah ada. Kalau sesuatu yang baru tidak punya tempat di tabel, tanyakan ke pemilik produk sebelum membuat tempat baru.

| Yang bertambah | Tempatnya | Contoh |
| --- | --- | --- |
| Proses yang di-deploy | Satu berkas di akar `src/` | `src/console.ts` untuk operator, `src/agent.ts` untuk agen server dan pipeline rilis, `src/portal.ts` untuk klien. Nanti `src/worker.ts` |
| Kemampuan bersama | `src/platform/<kemampuan>/` dengan `index.ts`. Kemampuan yang memuat lebih dari satu fitur memecahnya ke subfolder fitur | `src/platform/database/`, `src/platform/operator-identity/sso/` |
| Area bisnis, lalu fitur | `src/<area>/<fitur>/` | `src/environments/provision/`, `src/sites/enrollment/` |
| Peran berkas | Akhiran `.schema.ts`, `.service.ts`, `.routes.ts`, dan nanti `.page.tsx` | `environment.service.ts` |
| Test | `test/` di akar repo, dengan susunan folder yang sama dengan `src/` (atau `scripts/` untuk test skrip). Bantuan test di `test/support/` | `test/platform/oidc/oidc.test.ts` untuk `src/platform/oidc/index.ts` |
| Pemanggil route atau layar | `.console.routes.ts`, `.agent.routes.ts`, `.portal.routes.ts`, `.console.page.tsx`, dan `.portal.page.tsx` | `site.agent.routes.ts` |
| Pintu area per pemanggil | `index.ts` untuk layanan bersama, `index.<pemanggil>.ts` untuk route satu pemanggil | `src/sites/index.agent.ts` |
| Migration | `database/migrations/` | `0001_baseline.sql` |
| Kontrak | `contracts/agent/` untuk API agen, `contracts/onboarding/` untuk API onboarding | `contracts/agent/openapi.yaml` |
| Layar | `.page.tsx` di folder fitur. Bingkai layar (layout, menu, login) di `src/platform/shell/` | `environment.console.page.tsx` |

- Area yang direncanakan: `customers` (customer, registri tenant, entitlement), `environments` (registri, operasi dengan lease, runner, provisioning, upgrade, salin, pembersihan), `sites` (server klien: enrollment, antrean operasi, laporan, lisensi), `releases` (registri rilis, Harbor), `settings` (setelan konsol, DNS), dan `products` (tenant produk lama selama masih dipakai).
- Setiap proses memuat router untuk pemanggilnya sendiri lewat `serve()` di `src/platform/http/`. Route yang tidak ada di router itu tidak bisa dijangkau dari prosesnya, jadi rute operator tidak pernah ada di proses yang terbuka untuk customer atau agen.
- `index.ts` adalah satu-satunya pintu publik sebuah kemampuan atau area untuk layanan bersama. Route satu pemanggil keluar lewat `index.<pemanggil>.ts`, supaya proses lain bisa memakai layanan area itu tanpa ikut memuat route-nya. Berkas di dalam satu folder boleh saling meng-import langsung.
- Aturan bisnis yang dipakai beberapa pemanggil ada di `.service.ts`, yang namanya tidak membawa pemanggil.
- Test ada di `test/`, tidak di `src/`, mengikuti contoh di dokumentasi Elysia ([Unit Test](https://elysiajs.com/patterns/unit-test.html)) dan contoh project references TypeScript. `src/` hanya berisi kode yang di-deploy, dan folder fitur tidak tercampur test. Keputusan pemilik produk, 9 November 2026, menggantikan aturan lama yang menaruh test di samping berkasnya.
- Folder test mengikuti folder kode yang diujinya, jadi test sebuah berkas dicari di path yang sama di bawah `test/`. Test yang menguji beberapa bagian sekaligus, misalnya kedua proses, ada di folder bagian yang paling atas, misalnya `test/processes.test.ts`. Penyedia tiruan dan pembuat aplikasi test ada di `test/support/`.
- Test memanggil kode lewat pintunya (`index.ts`, `index.<pemanggil>.ts`) bila yang diuji perilaku yang dilihat pemanggil, dan langsung ke berkasnya bila yang diuji bagian dalam, misalnya TOTP atau tanda tangan cookie.
- Route ditulis sebagai procedure oRPC, bukan controller Elysia. Elysia hanya server HTTP: satu route `app.all('*')` yang meneruskan request ke handler OpenAPI oRPC, karena hanya bentuk itu yang diukur di [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md). Ini sengaja menyimpang dari [best practice Elysia](https://elysiajs.com/essential/best-practice.html) yang menjadikan satu instance Elysia sebagai satu controller. Yang tetap diikuti dari halaman itu: satu folder per fitur, schema sebagai satu-satunya sumber tipe dan validasi (`z.infer`, tanpa `interface` kembaran), dan service yang menerima nilai yang ia butuhkan (misalnya `db`), bukan seluruh context request.
- Layar konsol adalah SPA React dengan TanStack Router dan TanStack Query di atas API oRPC, sama dengan operations-metta. Aturannya di bagian [Layar](#layar).
- `bun run check:boundaries` menolak impor yang melewati pintu sebuah kemampuan atau area, berkas satu pemanggil yang meng-import berkas pemanggil lain, proses yang memuat berkas pemanggil lain di mana pun di rantai impornya, proses tanpa pemanggil (misalnya `worker.ts`) yang memuat route, kode selain test yang meng-import berkas proses, test di luar `test/`, folder test yang tidak punya pasangan di `src/` atau `scripts/`, dan kode di `src/` atau `scripts/` yang meng-import `test/`.

## Konsol dan portal

- Konsol dan portal di-deploy terpisah, masing-masing dengan host dan login sendiri. Konsol memakai login operator dan SSO operator. Portal hanya memakai SSO, dengan akses yang lahir dari undangan; rinciannya di [Portal klien](#portal-klien).
- Rute operator tidak bisa dijangkau dari host portal. Di konsol, yang bukan operator mendapat 404, bukan 403, karena 403 memberi tahu bahwa alamat itu ada.
- Konsol dan portal memanggil layanan onboarding yang sama. Dari portal, customer tidak bisa memilih apa yang hanya boleh dipilih operator, misalnya owner, database, rilis, akun dukungan, dan tenggat.
- Pengelolaan pengguna dan role di dalam tenant milik operations-metta, bukan konsol atau portal.
- SSO operator menautkan identitas lewat `iss` dan `sub`, tidak pernah lewat email. Login SSO tidak pernah membuat akun operator.
- Operator punya tabel `operators` sendiri, terpisah dari `users` milik customer (keputusan pemilik produk, 9 November 2026). Karena tidak ada akun customer yang bisa login di konsol, request tanpa sesi operator yang sah mendapat 401. Aturan 404 di atas berlaku bila kelak ada akun selain operator yang bisa memegang sesi konsol.
- Operator baru dibuat dengan `bun src/cli.ts create-operator --name <nama> --email <email>` (di container: `bun dist/cli.js ...`). Password dikirim lewat stdin. Perintah ini menulis `operator.created` ke jejak audit.
- Sesi konsol adalah cookie `HttpOnly`, `SameSite=Strict`, yang ditandatangani HMAC-SHA256 dengan `APP_KEY`; tidak ada tabel sesi. Logout mengisi `operators.sessions_valid_after`, sehingga semua sesi operator itu berakhir, termasuk di perangkat lain. Request yang mengubah sesuatu wajib `Content-Type: application/json`, supaya form dari situs lain tidak bisa mengirimnya.
- 2FA operator memakai TOTP dan opsional, sama dengan CoreERP (keputusan pemilik produk, 9 November 2026). Operator menyalakannya sendiri: `POST /api/v1/two-factor` dengan password, lalu `POST /api/v1/two-factor/confirm` dengan kode dari aplikasi authenticator, yang membalas delapan kode pemulihan sekali saja. Bila 2FA aktif, password yang benar hanya memberi cookie tunggu lima menit untuk `POST /login/two-factor`, bukan sesi. Kode TOTP tidak bisa dipakai dua kali, dan kode pemulihan dicoret begitu dipakai. Secret dan kode pemulihan disimpan terenkripsi AES-256-GCM dengan kunci turunan `APP_KEY`.
- SSO operator memakai OpenID Connect, alur kode otorisasi dengan PKCE S256, dan disetel lewat `CONSOLE_SSO_ISSUER`, `CONSOLE_SSO_CLIENT_ID`, `CONSOLE_SSO_CLIENT_SECRET`, serta `CONSOLE_SSO_REDIRECT_URI` (nama yang sama dengan konsol CoreERP). Tanpa keempatnya, setiap route SSO menjawab 404.
  - Tautan ada di `operator_identities`, terpisah dari `external_identities` milik pengguna customer. Operator menautkan akunnya sendiri lewat `POST /api/v1/sso/link` dengan password diketik ulang, lalu membuka `authorize_url` yang dibalas. Melepas tautan lewat `DELETE /api/v1/sso/link`. Keduanya menulis `sso.link` atau `sso.unlink` ke jejak audit.
  - Login SSO dimulai di `GET /sso/start` dan selesai di `GET /sso/callback`. Akun SSO yang belum tertaut ditolak. 2FA yang dinyalakan operator tetap diminta walau ia masuk lewat SSO; di CoreERP jalur SSO melewatinya.
  - ID token diverifikasi sendiri tanpa library JWT: RS256 terhadap JWKS penyedia (diambil ulang sekali bila `kid` tidak dikenal), `iss`, `aud`, `exp`, dan `nbf` dengan toleransi 60 detik. `nonce` yang ada wajib cocok. Penyedia SSO kami tidak mengembalikan `nonce` pada alur kode, dan ketiadaannya diterima karena PKCE sudah mengikat kode ke upacaranya.
  - Upacara SSO disimpan di cookie terenkripsi `SameSite=Lax` dengan `Path=/sso`, karena cookie `Strict` tidak ikut saat penyedia mengarahkan browser kembali. Callback menjawab halaman yang berpindah sendiri, supaya cookie sesi `Strict` sudah ikut di halaman tujuan.
  - `POST /sso/backchannel-logout` menerima logout token dari penyedia dan mengakhiri semua sesi operator yang tertaut ke `sub`-nya. `jti` yang sama ditolak selama token itu masih bisa diterima.
- Login yang gagal dibatasi lima kali per menit untuk setiap pasangan email dan alamat IP. Kode 2FA dan konfirmasi password dibatasi dengan cara yang sama, per operator dan alamat IP. Hitungannya ada di tabel `rate_limits`, jadi berlaku sama di semua proses.
- Jejak audit ditulis dengan `recordAudit()` dari `src/platform/audit/`. Fungsi itu menolak berjalan di luar transaksi, supaya baris audit selalu ikut transaksi perubahannya.

## Layar

Keputusan pemilik produk, 10 November 2026: layar konsol memakai susunan yang sama dengan layar operations-metta, yaitu SPA dengan TanStack Router dan TanStack Query di atas API oRPC, bukan Inertia. Server tidak merender halaman. Ia menyajikan satu dokumen yang sama untuk setiap URL layar, dan layar mengambil datanya sendiri dari `/api/`.

- **Hanya proses konsol dan portal yang menyajikan layar, masing-masing dari bundle sendiri.** `src/console.ts` memberi `clientBuild(CLIENT_DIR)` ke `serve()`, `src/portal.ts` memberi `clientBuild(PORTAL_CLIENT_DIR)`; proses agen tidak, jadi URL layar di sana dijawab 404 JSON seperti alamat lain.
- **URL layar dan URL data terpisah.** Data hanya di bawah `/api/`. URL lain milik layar, misalnya `/customers` dan `/customers/new`. Pengecualiannya alamat yang dijawab server: `GET /up`, `/sso/...` untuk upacara SSO, serta `POST /login`, `POST /login/two-factor`, dan `POST /logout`.
  - `src/platform/http/spa.ts` memeriksa dua hal sebelum database disentuh. `GET /build/<berkas>` mendapat berkas build ber-hash yang tercatat di manifest, dengan cache `immutable`. GET lain di luar alamat server mendapat dokumen layar.
  - Selain dua hal itu, semuanya diteruskan ke oRPC. Permintaan `/api/...` tidak pernah mendapat dokumen layar, dan 404-nya tetap JSON.
  - Procedure baru yang dibaca layar ditulis di bawah `/api/v1/...`. GET oRPC di luar `/api/` tertutup dokumen layar, kecuali ditambahkan ke `isServerPath()`.
- **Halaman** adalah berkas `<fitur>.console.page.tsx` atau `<fitur>.portal.page.tsx` di folder fiturnya, yang meng-export `page` dari `definePage({ path, layout, title, validateSearch?, component })`. Halaman konsol hanya masuk bundle konsol dan halaman portal hanya bundle portal; halaman tanpa salah satu akhiran itu ditolak generator.
  - `path` adalah URL layar dan ditulis sebagai teks literal. Nama dan folder berkas tidak menentukan URL.
  - `layout: 'app'` memasang halaman di dalam bingkai konsol dan mewajibkan login. `'auth'` dipakai untuk halaman sebelum login.
  - Id route adalah id layout ditambah path, misalnya `/_app/customers` atau `/_auth/login`. `Link`, `navigate`, dan `redirect` memakai path, dan TypeScript menolak path yang tidak ada.
  - Komponen halaman dan layout menulis tipe kembaliannya (`(): ReactNode`), supaya tipe route tree tidak hilang diam-diam.
- **Route tree dirakit otomatis.** `scripts/generate-client.ts` membaca setiap `.page.tsx` di `src/`, lalu menulis untuk konsol `src/client.tsx` (entry peramban beserta route tree-nya) dan `src/platform/shell/api-contract.generated.json` (bentuk route oRPC konsol untuk klien di peramban), dan untuk portal `src/portal-client.tsx` dan `src/platform/shell/api-contract.portal.generated.json`. Semuanya di-commit dan tidak pernah disunting tangan. `bun run build`, `bun run dev`, dan `bun run dev:portal` menulisnya ulang, dan `bun run check:generated` menolak berkas yang tertinggal.
- **Bingkai portal** ada di `src/platform/shell/` dengan akhiran `.portal`: `index.portal.ts` (pintu untuk halaman portal), `api.portal.ts`, `router.portal.tsx`, dan `portal-layout.portal.tsx`. Yang dipakai kedua bundle tanpa akhiran: `runtime.tsx` (query client, start, halaman galat dan memuat), `api-client.ts` (`ApiError`, `errorText`, link oRPC), `page.ts`, `auth-layout.tsx`. Halaman portal meng-import dari `index.portal.ts`, tidak dari `index.ts`. `check:boundaries` menolak entry peramban yang memuat berkas bertipe router proses lain, jadi klien API konsol tidak pernah ikut bundle portal.
- **Dua program TypeScript.** Setiap entry peramban mendaftarkan router-nya ke `Register` TanStack Router, dan dua pendaftaran tidak bisa hidup di satu program. `tsconfig.json` mengecualikan berkas peramban portal, dan `tsconfig.portal.json` memeriksanya dari `src/portal-client.tsx`. `bun run typecheck` menjalankan keduanya.
- **Data.** Halaman memanggil API lewat `api` (klien oRPC) dan `orpc` (TanStack Query) dari `src/platform/shell/index.ts`, atau dari `index.portal.ts` untuk halaman portal. Tipe input dan output datang dari router di `src/console.ts` atau `src/portal.ts`, jadi tidak ditulis ulang di layar. Body yang diperiksa handler, bukan oRPC, diberi tipe lewat `z.custom<...>()`, supaya pesan 422 per field-nya tetap milik service. Kegagalan API menjadi `ApiError`, berisi status, pesan, error per field, dan kodenya.
- **Sesi.** Layar memakai cookie sesi konsol yang sudah ada. Klien mengirim setiap perubahan sebagai JSON, termasuk yang tanpa body, karena konsol menolak yang lain. Data halaman yang dijawab 401 membawa operator ke `/login?redirect=<asal>`; simpan yang gagal karena sesi habis menampilkan pesan, dan isian form tetap ada.
- **Kode peramban dan kode server tidak bercampur.** Kode peramban adalah `src/client.tsx`, `src/portal-client.tsx`, `src/platform/shell/`, dan setiap berkas `.tsx`. Ia hanya mengambil tipe dari kode server (`import type`), dan kode server tidak meng-import-nya. Hanya kedua entry peramban yang meng-import halaman. `check:boundaries` menjaga ketiganya.
- **Paket UI** `packages/ui` (`@control-plane-metta/ui`) disalin dari `@operations-metta/ui` sebagai titik awal dan berkembang sendiri di repo ini. Tidak ada skrip penyelaras dan tidak ada ketergantungan pada operations-metta.
- **Build.** `bun run build` membundel proses server ke `dist/` (`console.js`, `agent.js`, `portal.js`, `cli.js`), `src/client.tsx` ke `dist/client/`, dan `src/portal-client.tsx` ke `dist/portal-client/`, masing-masing beserta `src/platform/shell/app.css`, dengan nama `<nama>-<hash>.<ext>`, lalu menulis `manifest.json` di setiap folder. Tailwind v4 dijalankan lewat `@tailwindcss/node` dan `@tailwindcss/oxide`; font `@fontsource` ditulis sebagai berkas sendiri.

### Menjalankan seluruh alur di laptop

`bun run dev:stack` menjalankan konsol (`localhost:8100`), agen (`8101`), operations (`8102`), dan worker sekaligus.
Clone operations-metta dicari di sebelah repo ini atau di sebelah leluhurnya, atau ditunjuk lewat `OPERATIONS_DIR`.
Butuh Docker: database keduanya ada di satu container `metta-dev-db` (port `55433`, volume bernama sama).

- Login konsol memakai `dev/operator.json`. Akun itu hanya untuk laptop.
- Customer yang dibuat di konsol disiapkan worker laptop. Kliniknya dibuka di `http://<tenant>.localhost:8102`,
  demo dan sandbox di `http://<tenant>.<jenis>.localhost:8102`. Peramban mengarahkan `*.localhost` ke laptop sendiri,
  jadi tidak perlu DNS atau sertifikat.
- `APP_KEY` kedua sisi dan kunci worker tersimpan di `~/.metta-dev`, supaya setiap worktree memakai host runtime yang
  sama. Menghapus folder itu membuat host runtime baru; host lama tidak lagi melapor dan tidak dipilih penempatan.
- Aman diulang: database, migration, operator, dan host runtime yang sudah ada dipakai lagi. Mulai dari nol dengan
  `docker rm -f metta-dev-db && docker volume rm metta-dev-db`.
- Ctrl+C menghentikan keempat proses. Satu proses yang berhenti sendiri menghentikan semuanya.

### Menjalankan layar di laptop

Butuh database yang sudah dimigrasi, `APP_KEY` (32 byte, `base64:...`), dan satu operator dari `bun src/cli.ts create-operator`. Tanpa HTTPS, isi `SESSION_SECURE_COOKIE=false` supaya peramban menyimpan cookie sesi. Lalu `bun run dev`: proses konsol berjalan dengan `bun --watch`, dan build peramban diulang setiap kali berkas di `src/` atau `packages/ui/src/` berubah. Muat ulang halaman untuk melihat hasilnya.

## Portal klien

Layar untuk pemilik dan admin klinik, terpisah dari konsol operator: database, repo, dan image sama, hanya alamat dan prosesnya yang berbeda. Prosesnya `src/portal.ts` (di container: `bun dist/portal.js`), yang hanya memuat route `.portal.routes.ts` dan menyajikan layar dari `dist/portal-client/`. Hari ini isinya baru daftar lingkungan dan module setiap klinik, hanya baca.

- **Env.** Selain `DB_*`, `APP_KEY`, `HOST`, `PORT`, dan `SESSION_*` yang sama dengan konsol: `PORTAL_URL` (alamat portal, misalnya `https://portal.example.com`), `PORTAL_SSO_ISSUER`, `PORTAL_SSO_CLIENT_ID`, dan `PORTAL_SSO_CLIENT_SECRET`. Keempatnya diisi bersama; tanpa itu proses portal menolak berjalan. `PORTAL_CLIENT_DIR` bawaannya `dist/portal-client`. Konsol juga membaca keempatnya untuk membuat tautan undangan.
- **Alamat yang didaftarkan di klien SSO portal** di penyedia SSO: `<PORTAL_URL>/sso/callback` sebagai redirect URI, dan `<PORTAL_URL>/sso/backchannel-logout` sebagai back-channel logout URI. Klien SSO portal terpisah dari klien SSO konsol.
- **Alamat klinik.** `OPERATIONS_URL` (misalnya `https://operations.example.com`) dibaca konsol dan portal untuk menampilkan alamat setiap lingkungan: produksi di `<tenant>.<host>`, demo dan sandbox di `<tenant>.<jenis>.<host>`, sama dengan aturan operations-metta. Tanpa setelan ini alamat tidak ditampilkan.
- **Akses hanya lewat undangan.** Operator mengundang dari halaman customer di konsol; penyedia SSO mengirim tautan `<PORTAL_URL>/invitation?token=...` ke email penerima. Pemegang tautan masuk SSO lewat `GET /sso/start?invitation=<token>`, dan callback menautkan `iss` dan `sub`-nya ke customer itu di `client_portal_users`, di dalam transaksi yang mengunci undangan dan memeriksanya ulang. Email akun SSO tidak pernah dicocokkan dengan email undangan: yang membuktikan adalah tautan yang sampai ke kotak masuk. Token diperiksa sebelum browser dibawa ke penyedia; yang sudah dipakai, dibatalkan, atau lewat masanya dibawa ke `/login?portal_error=invitation-invalid`.
- **Login** lewat `GET /sso/start` hanya diterima bila identitas itu masih memegang akses hidup; yang belum dibawa ke `/login?portal_error=not-linked`. Upacara SSO sama dengan konsol (PKCE, cookie upacara `Lax` di `Path=/sso`, callback yang berpindah sendiri), lewat `src/platform/oidc/` yang dipakai bersama.
- **Sesi** adalah cookie `<SESSION_COOKIE>_portal`, `HttpOnly`, `SameSite=Strict`, terenkripsi dengan kunci turunan `APP_KEY`, berisi `iss`, `sub`, dan waktu login, berumur `SESSION_LIFETIME` yang diperpanjang setiap request. Setiap request memeriksa ulang akses hidup identitas itu, jadi akses yang dicabut operator berakhir di request berikutnya. Logout dan back-channel logout mengisi `client_portal_users.sessions_valid_after`, yang mengakhiri semua sesi identitas itu, termasuk di perangkat lain.
- **Data selalu disaring akses.** Setiap query portal mencari customer lewat `client_portal_users` identitas yang sedang login, tidak pernah lewat id customer dari permintaan.
- Di laptop: `bun run dev:portal`. Proses ini butuh klien SSO portal sungguhan, jadi belum ikut `bun run dev:stack`.

## Aturan konsol, agen, dan rilis

- Konsol mengelola tenant, lingkungan, dan rilis.
- Konsol hanya boleh membuka data bisnis klinik lewat akses yang punya tenggat dan tercatat di jejak audit.
- Setiap tindakan operator yang mengubah sesuatu menulis satu baris `operator_audit_events` di transaksi yang sama dengan perubahannya. Isinya tidak pernah memuat nilai rahasia.
- Secret tidak pernah dikirim sebagai argumen perintah, karena argumen terbaca `ps` dan tersimpan di riwayat shell. Layar menampilkan sidik jari kunci, tidak pernah isinya.
- Situs, yaitu server klien tempat agen berjalan, ditentukan dari signature permintaan yang sudah diverifikasi, tidak pernah dari body. Membaca `site_id` dari body membuat satu situs bisa memerintah situs lain.
- API agen ada di `contracts/agent/openapi.yaml`, disalin dari CoreERP karena agen di server klien dibangun darinya. Bentuk jawaban, kode galat, dan bentuk tanda tangannya tidak diubah. Perubahan yang dibutuhkan dirilis sebagai versi API baru, bersama agen yang memakainya.
- Id di API agen tetap berbentuk ULID: `site_id`, `tenant_id`, `keyid`, dan id operasi. Agen yang mendaftar di CoreERP menyimpan `site_id` ULID, dan operasi `install` di agen menolak `tenant_id` yang bukan ULID. Database menyimpan uuid dengan nilai 128 bit yang sama; `src/sites/agent-id.ts` menerjemahkannya di batas API.
- Rilis didaftarkan alur rilis lewat `POST /api/releases/v1` dengan token `CONSOLE_RELEASE_TOKEN`. Rilis diterima hanya bila `SHA256SUMS` ditandatangani kunci privat rilis (diperiksa dengan `CONSOLE_RELEASE_PUBLIC_KEY_PATH`), checksum tepat tiga berkasnya cocok, dan manifest v2 menyebut setiap image di project `CONSOLE_REGISTRY_PROJECT` lewat digest. Control plane tidak pernah memegang kunci privat rilis, jadi control plane yang dibobol hanya bisa memilih di antara rilis yang sudah ada. Isi berbeda untuk nomor rilis yang sama ditolak; nomor rilis baru dirakit ulang.
- Agen menarik image rilis dengan robot Harbor pull-only yang lahir per operasi `install` atau `upgrade` saat agen memintanya (`POST /api/agent/v1/registry-credential`), dan dihapus begitu operasinya tidak lagi dipegang. Tanpa penjadwal: sapuan berjalan saat agen mengambil operasi, saat menutupnya, dan saat situs dicabut. Robot yang gagal dihapus dicoba lagi di sapuan berikutnya; umurnya di Harbor (`CONSOLE_REGISTRY_ROBOT_DAYS`) penjaga terakhir.
- Robot sistem Harbor disimpan terenkripsi di `console_settings` lewat `bun dist/cli.js set-registry-robot` (JSON dari stdin), hanya setelah Harbor membuktikan robot itu melihat project registry. Status HTTP saja tidak cukup: Harbor menjawab kredensial yang salah dengan `200 []`.
- Nomor rilis dibandingkan per bagian sebagai angka (`0.10.0` lebih baru dari `0.9.1`). `upgrade` hanya ke rilis yang terdaftar untuk edisi situs dan lebih baru dari rilis terpasang.
- Antrean operasi situs tidak punya penjadwal. Tenggat yang lewat (gagal) dan permintaan yang basi tujuh hari (kedaluwarsa) ditutup saat antrean dibaca. Setiap penutupan membuang `admin_password_hash` dari parameternya.
- Bukti perubahan API agen adalah agen bash CoreERP (`deploy/agent/coreerp-agent`) yang dijalankan sungguhan terhadap proses agen, bukan hanya test dengan klien tiruan.
- Kesalahan program (jawaban 500, kesalahan yang tidak tertangkap, kesalahan CLI) dikirim ke Sentry lewat `src/platform/error-reporting/` bila `SENTRY_DSN` diisi; project-nya `control-plane-metta` di Sentry swakelola. Penolakan yang bagian dari aturan tidak dikirim. Isi request, header, cookie, query, dan alamat IP tidak pernah ikut: hanya integrasi untuk kesalahan yang dipasang, tanpa instrumentasi Bun.serve, HTTP, maupun Postgres, karena SDK bawaannya mengirim isi request dan IP.
- Katalog, entitlement, dan pemasangan module tidak sama. Katalog berarti produk dikenal, entitlement berarti tenant berhak memakai, dan `installed` hanya sah setelah migration module berhasil dan tercatat di `core_module_installations`. Layar berlabel "terpasang" membaca catatan pemasangan itu, tidak menyimpulkannya dari entitlement. Di CoreERP, layar yang menukar keduanya pernah menampilkan module yang belum dibeli sebagai terpasang.
- Customer baru lahir dari `POST /api/v1/customers` dalam satu transaksi: customer, tenant, lingkungan pertamanya (produksi, atau demo dengan tanggal berakhir dari operator), dan operasi `provision` berstatus `requested` untuk worker operations-metta. Pemilik tenant tercatat sebelum operations membuat apa pun. Header `Idempotency-Key` wajib; permintaan ulang dengan kunci yang sama mengembalikan hasil pertama tanpa password, dan kunci yang sama dengan isi berbeda ditolak. Password sementara admin pertama tampil sekali; hanya hash-nya yang dibawa parameter operasi, dan hash itu hanya boleh ada selama operasinya terbuka (CHECK di database). Slug tenant adalah label alamat, tidak pernah dipakai ulang, dan label `admin`, `www`, `api`, `registry` ditolak.
- Parameter operasi `provision` berbentuk permintaan penyiapan operations-metta (`provisionRequestSchema` di `src/platform/environment/` repo itu). Mengubah salah satunya berarti mengubah keduanya.
- Worker operations-metta di host runtime menarik operasi lingkungan lewat `/api/worker/v1` (kontrak `contracts/worker/openapi.yaml`), dilayani proses agen. Host ditentukan dari tanda tangan RFC 9421 yang sama dengan agen, dengan `keyid` = id host; kunci publiknya didaftarkan `bun dist/cli.js add-runtime-host --name <nama>` (PEM RSA dari stdin). Lingkungan terikat ke host pertama yang mengambil operasinya. Setiap langkah dan penutupan mensyaratkan operasi masih dipegang host itu dan tenggatnya belum lewat (compare-and-set); tenggat yang lewat ditutup gagal saat antrean dibaca dan lingkungannya menjadi `degraded`. Penutupan membuang hash password admin dan mengubah status lingkungan di transaksi yang sama.
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
- Konfigurasi runtime dan aturan database ditetapkan skill `control-plane-metta-bun-elysia` dan [`docs/dev/39-pindah-ke-bun-elysia.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/39-pindah-ke-bun-elysia.md). Berkas ini sengaja tidak menyalin angkanya. Baca dari sumbernya.
- Tidak ada baris yang dihapus fisik. Menghapus berarti mengisi `deleted_at`. Indeks unik pada kode bisnis wajib parsial (`WHERE deleted_at IS NULL`), supaya kode yang sudah dihapus bisa dipakai lagi. Rinciannya di [Penghapusan lunak](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#penghapusan-lunak).

## Bahasa

- **Nama di dalam kode ditulis bahasa Inggris, tanpa kecuali.** Ini berlaku untuk berkas, folder, fungsi, class, type, variabel, properti, nama route, kunci config, variabel env, nama perintah CLI, dan komponen UI. Contohnya, `siapkanLingkungan` menjadi `provisionEnvironment`.
- Yang tetap bahasa Indonesia, dan ini disengaja: nama tabel, kolom, index, dan constraint database, teks yang dibaca pengguna di layar, alamat URL layar yang diketik operator, komentar, docs, dan pesan commit.
- Kalau sebuah istilah tidak punya padanan Inggris yang jelas, pakai istilah Dynamics 365 untuk hal yang sama. Jangan mengarang terjemahan harfiah.
- Istilah teknis yang sudah baku ditulis apa adanya, misalnya push, pull, scope, token, signing secret, webhook, endpoint, GET, POST, dan PUT. Ini berlaku di layar, pesan, kontrak, dan docs. Tulis "scope `vendors.read`", bukan "cakupan `vendors.read`". Batasnya ada di skill `operations-metta-docs` operations-metta, bagian [Where the loanword boundary sits](https://github.com/MettaDevs/operations-metta/blob/main/.agents/skills/operations-metta-docs/SKILL.md#where-the-loanword-boundary-sits).
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

- Skill hanya ada di `.agents/skills/` (keputusan pemilik produk, 9 November 2026). Folder `.claude/skills/` sudah dihapus. Akibatnya: menurut dokumentasi Claude Code saat ini, skill proyek dibaca dari `.claude/skills/`, jadi sesi Claude Code tidak memuat skill repo ini sampai Claude Code membaca `.agents/skills/`. Sampai saat itu, buka `SKILL.md`-nya langsung bila tugas menyentuh bidang sebuah skill.
- Skill `control-plane-metta-console` dan `control-plane-metta-release` dipindah dari CoreERP pada 9 November 2026, dari `coreerp-konsol` dan `coreerp-harbor`, dengan nama baru tanpa "erp". Versi yang berlaku ada di sini; salinannya di CoreERP tidak diperbarui lagi.
- `control-plane-metta-bun-elysia` adalah salinan skill `operations-metta-bun-elysia` milik operations-metta. Isinya sama kecuali `name`, jadi "this repository" di dalamnya berarti operations-metta, dan path `src/...` menunjuk ke susunan repo itu. Bila skill di operations-metta berubah, salin ulang ke sini dalam PR tersendiri. Path `docs/...` di dalamnya menunjuk ke repo CoreERP sebagai bacaan.

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

Jalankan dari akar repo. Kelima pemeriksaan ini wajib lulus untuk setiap perubahan:

```bash
bun run typecheck
bun test
bun run format:check
bun run check:boundaries
bun run check:generated
```

Test yang membutuhkan database dilewati bila `DB_HOST` kosong. CI selalu menjalankannya terhadap database yang sudah dimigrasi. Sebelum menyatakan perubahan yang menyentuh SQL hijau, jalankan juga test itu terhadap database kosong yang sudah dimigrasi, dengan `DB_*` mengarah ke sana.

`bun run build` hanya perlu dijalankan bila perubahan menyentuh hasil build: `package.json`, `bun.lock`, `tsconfig.json`, `Dockerfile`, berkas proses di akar `src/`, layar (`.tsx`, `src/platform/shell/`), atau `packages/`. CI tetap menjalankannya di setiap PR, bersama `bun run migrate` atas database kosong dua kali: sekali untuk menerapkan, sekali untuk memastikan tidak ada yang tersisa.
