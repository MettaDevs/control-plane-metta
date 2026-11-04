# control-plane-metta

- Repo ini adalah control plane kami untuk onboarding, trial gratis 30 hari Praktik Dokter, tenant, lingkungan, rilis, dan agen server. Di dalamnya akan ada konsol operator internal dan, menyusul kemudian, portal customer. Keduanya di-deploy terpisah.
- **Belum ada kode.** Pekerjaan pertama adalah onboarding, yaitu membuat tenant dan lingkungan, karena trial gratis Praktik Dokter membutuhkannya.
- Runtime yang dijalankan untuk klinik, yaitu ERP dan Praktik Dokter, milik repo [operations-metta](https://github.com/MettaDevs/operations-metta).
- Untuk alur yang sudah ada di konsol operator CoreERP (`apps/control-plane`, alamatnya admin.erp), CoreERP tetap acuan perilaku sampai alur itu selesai dipindah. Aturan konsol itu ada di skill [`coreerp-konsol`](https://github.com/MettaDevs/coreERP/blob/main/.agents/skills/coreerp-konsol/SKILL.md), [`docs/dev/31-admin-erp-control-plane.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/31-admin-erp-control-plane.md), dan [`docs/dev/32-sso.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/32-sso.md).
- Jaga perubahan dan dependency tetap minimal. Jangan membuat abstraksi atau compatibility layer spekulatif. Kalau ada yang membingungkan, tanyakan langsung ke pemilik produk dan berhenti dulu sampai konteksnya jelas.
- SaaS dikelola lewat control plane. On-prem perpetual berdiri sendiri, memakai update bertanda tangan, dan tidak mewajibkan telemetry.

## Susunan repo yang direncanakan

Belum ada satu pun folder ini.

- `api/` untuk backend control plane.
- `console/` untuk layar operator internal.
- `portal/` untuk layar customer: daftar trial, status trial, upgrade, langganan, dan tagihan.
- `contracts/` untuk kontrak milik repo ini.

## Konsol dan portal

- Konsol dan portal di-deploy terpisah, masing-masing dengan host dan login sendiri. Konsol memakai SSO operator. Portal memakai akun customer.
- Rute operator tidak bisa dijangkau dari host portal. Di konsol, yang bukan operator mendapat 404, bukan 403, karena 403 memberi tahu bahwa alamat itu ada.
- Konsol dan portal memanggil layanan onboarding yang sama. Dari portal, customer tidak bisa memilih apa yang hanya boleh dipilih operator, misalnya owner, database, rilis, akun dukungan, dan tenggat.
- Pengelolaan pengguna dan role di dalam tenant milik operations-metta, bukan konsol atau portal.
- SSO operator menautkan identitas lewat `iss` dan `sub`, tidak pernah lewat email. Login SSO tidak pernah membuat akun operator.

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

- Skema database sama persis dengan tabel sisi pusat CoreERP. Daftar tabelnya ditulis tangan di `modelSisiPusat()` pada [`apps/core/tests/Feature/Boundary/BatasPusatTest.php`](https://github.com/MettaDevs/coreERP/blob/main/apps/core/tests/Feature/Boundary/BatasPusatTest.php).
- Selama transisi, CoreERP pemilik skema dan migration. Repo ini tidak menulis migration. Tabel pusat baru dibuat lewat migration di CoreERP, beserta model penanda `OwnedByControlPlane` dan barisnya di `BatasPusatTest.php`.
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
- `coreerp-bun-elysia` disalin apa adanya dari CoreERP. Path `docs/...` di dalamnya menunjuk ke repo CoreERP. Kalimat di skill itu yang menyebut nama dan pembagian repo baru belum diputuskan ditulis sebelum repo ini dibuat. Pembagiannya sekarang tertulis di bagian atas berkas ini.
