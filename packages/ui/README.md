# @control-plane-metta/ui

Pustaka komponen UI untuk layar konsol operator. Disalin dari `@operations-metta/ui` milik [operations-metta](https://github.com/MettaDevs/operations-metta) pada commit `efe6295` (10 November 2026) sebagai titik awal, lalu berkembang sendiri di repo ini. Tidak ada skrip penyelaras: perubahan di salah satu repo tidak ikut ke repo lain, dan komponen yang dipakai konsol boleh berbeda rupa dari salinan asalnya.

```tsx
import { Input } from '@control-plane-metta/ui/input';
import { InlineLookup } from '@control-plane-metta/ui/inline-lookup';
import { applyCoreErpTheme } from '@control-plane-metta/ui/theme';
import '@control-plane-metta/ui/styles.css';
```

React dan ReactDOM adalah peer dependency. Paket ini workspace Bun yang tidak diterbitkan ke registry mana pun, dan exports-nya menunjuk langsung ke `src/` tanpa langkah build. Komponen `.tsx` terjangkau lewat pola `./*`; komponen `.ts` butuh baris exports sendiri, dan `test/exports.test.ts` menolak komponen yang belum terjangkau. Test ada di `test/` dan berjalan lewat `bun test` dari akar repo; skenario yang butuh DOM berjalan di proses sendiri lewat `test/support/scenario.ts`.

`InlineLookup` menyediakan pencarian langsung di field dengan label tetap terlihat.
Untuk record dari server, gunakan `loadItems({ query, cursor, signal })` yang
mengembalikan `{ items, nextCursor }`. Gunakan callback stabil (`useCallback`)
yang berubah ketika scope/parent berubah. Jangan mengambil seluruh master sebelum
membuka lookup. Popup dan Daftar lengkap memakai batch lewat scroll, dengan header
tetap terlihat; tidak ada navigasi nomor halaman. Props `pagination`, `page`, dan
`onPageChange` ditolak TypeScript. Array `items` tetap tersedia untuk data lokal
yang sudah dimiliki halaman; barisnya juga ditampilkan bertahap.

Pembukaan awal langsung meminta batch pertama. Pencarian ketikan diberi jeda
250 ms; request lama dibatalkan lewat AbortSignal,
batch dideduplikasi berdasarkan `getItemValue`, dan kegagalan tetap terlihat dengan
aksi Coba lagi. Provider harus meneruskan signal, menerapkan izin/scope tenant yang
sama untuk setiap batch, memakai urutan cursor unik yang stabil, dan memuat relasi
sekaligus. Jangan mengurutkan hanya batch server yang sudah diambil: sorting lokal
hanya aktif untuk sumber array. `displayValue` dan `onQueryChange` dipakai untuk
nomor baru yang boleh diisi manual; query tetap tidak menghapus record committed.
Popup dan Daftar lengkap berbagi state, hasil, pencarian, dan cursor pada field
yang sama; membuka daftar lengkap tidak mengulang request batch pertama. Hasil
field disimpan paling lama 30 detik pada instance itu, bukan cache global lintas
tenant. Perubahan source/scope serta aksi Baru atau Detail yang dapat mengubah
master membatalkannya. Array lokal tidak menggantikan provider backend untuk master.

Pemanggil memberi sumber `items` atau `loadItems`, `columns` DataTable, record `value`, `onValueChange`,
`getItemValue`, dan `getItemLabel`. `getSearchText` menentukan pencarian lintas kolom.
Popup menggunakan tabel SDK dengan sorting dan resize kolom; field mengikuti lebar kolom form.
Mengetik, menghapus teks, atau membatalkan pencarian mempertahankan record sebelumnya.
Tidak ada tombol X atau aksi unselect; `onValueChange` hanya mengirim record pengganti,
bukan `null`. `value` boleh `null` saat field belum mempunyai pilihan.
Detail dan Daftar lengkap tampil secara default dengan sumber dan kolom yang sama
dengan popup. Detail hanya baca dan nonaktif tanpa
record sasaran. Daftar lengkap memakai kandidat sementara dan Pilih/Batal.
`onDetails` dan `onFullList` mengganti dialog bawaan dengan alur bisnis khusus;
`showDetails={false}` / `showFullList={false}` menyembunyikan aksi lewat gate eksplisit.
Baru hanya tampil jika ada `onCreate` yang sudah diizinkan. Dialog bawaan tidak mengambil
data di luar provider atau memberikan izin edit. `onFullList` dapat mengganti alur
bisnis, tetapi tetap memakai lazy loading tanpa kontrol nomor halaman.
Di dalam dialog, berikan ref konten dialog melalui `portalContainer`. Pada `DialogContent`,
cegah Escape menutup dialog induk saat ref tersebut masih memuat
`[role="combobox"][aria-expanded="true"]`; popup menangani penutupannya sendiri.
Pengambilan data, izin, serta tindakan bisnis tetap ditangani pemanggil.

`PageDialog` dari `@control-plane-metta/ui/page-dialog` dipakai untuk kartu/form dan pemilih yang
memang dibuka sebagai halaman bertumpuk. Susun Root controlled open/onOpenChange,
`PageDialogContent` (content ref untuk portal), `PageDialogHeader` berisi Title/Description,
Body dan Footer/Action bila perlu. Header menyediakan Kembali, jumlah halaman, expand,
dan Tutup. `expanded`, `defaultExpanded`, dan `onExpandedChange` ada pada Content;
parameter `size` milik Dialog biasa tidak dipakai. Tidak memerlukan provider.

Di Shell, portal otomatis memakai outlet konten sehingga search/navbar tetap tersedia.
Halaman bawah tetap mounted, menjadi inert dan meredup; draft, scroll, dan ukuran
tersimpan ketika kembali. Escape menutup lapisan teratas, setelah popup field; fokus
kembali ke pemanggil. Di layar sempit halaman memenuhi konten, sedangkan jumlah lapisan
masih terlihat. Motion menghormati prefers-reduced-motion. Di luar Shell, portal
mengikuti viewport. Dialog konfirmasi kecil, AlertDialog, tooltip dan FieldHint tetap
memakai komponen masing-masing. Halaman penuh biasa tidak otomatis diubah menjadi modal.
Playground stack memakai mesin yang sama.

Prop `hint` pada `InlineLookup` menempatkan bantuan tepat setelah kontrol yang terlihat, tanpa memperlebar field atau menjauhkan ikon ke tepi baris.

`InlineLookup` memakai label di dalam field lewat `ComboboxInput label` dan mengisi lebar kolom form. Tentukan lebar kolom pada layout pemanggil; popup tabel memiliki ukuran tersendiri.
