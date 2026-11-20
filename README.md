# clioilc frontend

Dashboard clioilc dalam bentuk single-page app SvelteKit. Isinya:

- login dengan GitHub
- halaman `/device` untuk menyetujui `clioilc login`
- grafik penggunaan token per jam atau per hari

Semua data diambil dari backend (repo `clioilc-backend`). Kontrak API-nya ada di
`docs/api-v1.md` dan `docs/auth.md` di repo itu.

## Menjalankan

Backend harus sudah berjalan di `http://localhost:8000`.

```sh
cp .env.example .env    # PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev             # http://localhost:5173  (harus localhost, bukan 127.0.0.1)
npm run check           # svelte-check
npm run build           # hasil statis di build/
```

Untuk development, backend memakai `FRONTEND_URL=http://localhost:5173` (nilai default). Port
dan host di `vite.config.js` sengaja dikunci (`strictPort`), karena cookie session, CORS, dan
CSRF di backend bergantung pada origin ini.

## Halaman

| Path | Isi |
|---|---|
| `/` | Dashboard. Rentang 24 jam / 7 / 30 / 90 hari, per jam (sampai 7 hari) atau per hari, pilihan metrik (default: biaya), lima angka ringkasan, grafik kolom dengan tooltip (mouse atau panah kiri/kanan), dan tampilan tabel |
| `/device?code=…` | Menyetujui atau menolak `clioilc login`. Kode boleh huruf kecil dan tanpa tanda strip |
| `/auth/callback` | Tujuan setelah login GitHub. Mengecek session, lalu kembali ke `next` |
| `/login/error` | Tujuan saat login gagal (dipakai allauth) |

**Biaya** (`cost_usd`) adalah biaya setara harga API Claude, dihitung backend per pesan dengan
harga yang menempel saat pesan diterima (lihat `docs/pricing.md` di repo backend). Ini bukan
tagihan langganan. Pesan dari model yang belum punya harga tidak ikut dijumlahkan, dan
jumlahnya ditampilkan di bawah angka biaya.

Grafik memakai data publik dari `GET /api/v1/usage/report/` (`by=hour` atau `by=day`) dengan
zona waktu browser. Jam atau hari tanpa aktivitas diisi nol di sisi frontend. Isi percakapan
(timeline `activity/`, termasuk dekripsi e2e) belum ditampilkan.

## Struktur

```
src/lib/api.js              fetch ke API: cookie session + header X-CSRFToken
src/lib/session.svelte.js   status login (allauth headless), loginWithGitHub, logout
src/lib/usage.js            ambil report, isi jam/hari kosong, total
src/lib/ColumnChart.svelte  grafik kolom SVG (tanpa library)
src/lib/format.js           format angka dan waktu (id-ID, zona browser)
src/app.css                 token warna terang/gelap
src/routes/                 halaman
```

**Warna** diambil dari palet dataviz yang sudah divalidasi (satu seri, biru):
`#2a78d6` untuk mode terang dan `#3987e5` untuk mode gelap. Keduanya lolos semua pemeriksaan
validator, termasuk kontras ≥ 3:1 terhadap permukaan grafik. Mode gelap mengikuti
pengaturan OS.

## Deploy

Hasil `npm run build` adalah file statis di `build/` dengan `index.html` sebagai fallback
SPA. Bisa dilayani dari CDN atau static host mana pun. Pastikan semua path yang tidak
dikenal diarahkan ke `index.html`.

- Atur `PUBLIC_API_URL` **saat build**, karena nilainya ditanam ke dalam bundle.
- Frontend dan API harus satu site, misalnya `app.example.com` dan `api.example.com`.
  Di backend, isi `COOKIE_DOMAIN=.example.com`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`,
  dan `CSRF_TRUSTED_ORIGINS` dengan origin frontend.
