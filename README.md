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
| `/` | Di bagian bawah: **biaya per project** dan **per model** (atau metrik lain yang dipilih) untuk rentang yang sama, sebagai bar berperingkat (8 teratas, sisanya digabung ke "Other"), dengan nilai dan persentase tertulis. Nama project dipendekkan dengan membuang awalan folder yang paling banyak dipakai (`-Volumes-SSD1-Private-app` menjadi `app`); nama lengkapnya ada di tooltip. Di atas: kalender 53 minggu ala GitHub untuk **Succeeded** (tool berhasil) dan **Failed** (tool error + pesan gagal), klik satu hari untuk membuka aktivitasnya. Di bawahnya dashboard: Rentang 24 jam / 7 / 30 / 90 hari, per jam (sampai 7 hari) atau per hari, pilihan metrik (default: Cost), lima angka ringkasan, grafik kolom dengan tooltip (mouse atau panah kiri/kanan), dan tampilan tabel |
| `/activity?date=YYYY-MM-DD` | Timeline aktivitas satu hari: prompt, balasan agent, thinking, dan aksi tool dengan status dan pesan error, dikelompokkan per sesi seperti `clioilc activity`. Ada filter project, pencarian teks, filter **jenis** (You / Agent / Thinking / Tool; Thinking mati secara default, nyalakan sendiri untuk melihatnya di sela timeline, atau matikan yang lain untuk membaca thinking saja) dan **status** (All / Succeeded / Error, untuk tool dan balasan agent), serta biaya per balasan dan per sesi. Urutannya terbaru di atas, baik untuk sesi maupun entri di dalamnya. Tombol "Oldest first" membaliknya (`?order=asc`). Filter jenis dan status disimpan di URL (`?type=prompt,tool&status=error`). Klik kotak di baris Failed pada kalender akan membuka hari itu dengan filter Error aktif. Bisa dibuka dari klik batang grafik di dashboard |
| `/digest?from=&to=` | Ringkasan harian ala changelog: per hari, per project, berisi prompt yang kamu tulis ("You asked"), commit yang dibuat (dan apakah di-push), file yang diubah, masalah (tool/pesan gagal, dengan link ke Activity yang sudah terfilter), sesi, perkiraan waktu aktif, dan biaya. Preset Today / Yesterday / Last 7 days, atau rentang bebas sampai 14 hari |
| `/devices` | Daftar perangkat yang terhubung lewat `clioilc login`: nama, status **Active** (sync dalam 5 menit terakhir) atau **Idle**, waktu sync terakhir, jumlah pesan yang dikirim, pesan terbaru, dan kapan terhubung. **Revoke…** mencabut token perangkat setelah konfirmasi; perangkat itu langsung berhenti sync, data yang sudah terkirim tetap ada |
| `/device?code=…` | Menyetujui atau menolak `clioilc login`. Kode boleh huruf kecil dan tanpa tanda strip |
| `/auth/callback` | Tujuan setelah login GitHub. Mengecek session, lalu kembali ke `next` |
| `/login/error` | Tujuan saat login gagal (dipakai allauth) |

**Biaya** (`cost_usd`) adalah biaya setara harga API Claude, dihitung backend per pesan dengan
harga yang menempel saat pesan diterima (lihat `docs/pricing.md` di repo backend). Ini bukan
tagihan langganan. Pesan dari model yang belum punya harga tidak ikut dijumlahkan, dan
jumlahnya ditampilkan di bawah angka Cost.

Grafik memakai data publik dari `GET /api/v1/usage/report/` (`by=hour` atau `by=day`) dengan
zona waktu browser. Jam atau hari tanpa aktivitas diisi nol di sisi frontend. Timeline memakai `GET /api/v1/usage/activity/`.

**Digest** disusun di browser dari data `activity/` yang sama (satu request per hari), jadi juga
berlaku untuk akun e2e setelah passphrase dibuka. Tidak ada AI di dalamnya; semua yang tampil
berasal langsung dari log:

- **You asked:** baris pertama setiap prompt. Prompt subagent dan prompt bawaan harness
  (misalnya ringkasan sesi lanjutan) tidak ditampilkan.
- **Commits:** diambil dari perintah `git commit` yang berhasil di tool Bash. Pesannya dibaca
  dari `-m "…"`, heredoc `-F - <<'EOF'`, atau `-m "$(cat <<'EOF' …)"`. Commit yang dibuat lewat
  alias atau fungsi shell tidak terdeteksi.
- **Files changed:** path dari Edit/Write yang berhasil, relatif terhadap folder project.
  Scratchpad agent (`/tmp`) dan file di `~/.claude/` diabaikan.
- **Waktu aktif:** jumlah jeda antar-entri dalam satu sesi. Jeda lebih dari 15 menit dianggap
  idle.

**Markdown:** balasan agent dan thinking dirender sebagai markdown (`src/lib/markdown.js`:
marked + DOMPurify). Karena isinya berasal dari log, HTML mentah ditampilkan sebagai teks
(misalnya `<tool_use_error>`), gambar tidak dimuat, hanya link `http(s)` yang menjadi link
(dibuka di tab baru, `rel="noopener noreferrer nofollow"`), dan hasil akhirnya disaring lagi
dengan DOMPurify. Link ke file lokal (`src/x.rs#L10`) ditampilkan sebagai teks, dengan
path-nya di tooltip. Prompt dari user tetap ditampilkan sebagai teks biasa.

**Akun end-to-end:** halaman aktivitas meminta passphrase, lalu mendekripsi di browser
(`src/lib/e2e.js`: Argon2id lewat hash-wasm, AES-256-GCM lewat WebCrypto, format v1 dari
`docs/encryption.md` di repo backend). Data key hanya disimpan di memori tab, jadi passphrase
diminta lagi setelah halaman dimuat ulang. Modul ini sudah diuji terhadap test vector dan
ciphertext buatan CLI Rust.

Semua teks di antarmuka berbahasa Inggris, dengan format angka dan tanggal `en-US`
(`src/lib/format.js`).

## Struktur

```
src/lib/api.js              fetch ke API: cookie session + header X-CSRFToken
src/lib/session.svelte.js   status login (allauth headless), loginWithGitHub, logout
src/lib/usage.js            ambil report, isi jam/hari kosong, total
src/lib/ColumnChart.svelte  grafik kolom SVG (tanpa library)
src/lib/CalendarHeatmap.svelte  kalender berhasil/error 53 minggu
src/lib/digest.js           susun digest harian dari activity (tanpa AI)
src/lib/RankedBars.svelte   bar berperingkat (biaya per project / model)
src/lib/format.js           format angka, mata uang, dan waktu (id-ID, zona browser)
src/lib/activity.js         ambil activity, dekripsi, susun timeline per sesi
src/lib/e2e.js              dekripsi e2e (format v1)
src/lib/markdown.js         render markdown yang aman (marked + DOMPurify)
src/lib/vault.svelte.js     data key e2e di memori tab
src/app.css                 token warna terang/gelap
src/routes/                 halaman (/, /activity, /devices, /device, /auth/callback, /login/error)
```

**Warna** diambil dari palet dataviz yang sudah divalidasi:

- **Grafik kolom** (satu seri, biru): `#2a78d6` untuk mode terang dan `#3987e5` untuk mode
  gelap. Keduanya lolos semua pemeriksaan validator, termasuk kontras ≥ 3:1 terhadap
  permukaan grafik.
- **Kalender:** dua skala satu warna dengan 4 tingkat. Succeeded memakai biru (skala bawaan),
  Failed memakai oranye (skala kedua). Merah dan hijau tidak dipakai karena keduanya warna
  status. Tingkat oranye diturunkan dari oranye kategori 2 dengan lightness OKLCH yang sama
  seperti tingkat biru. Keempat skala lolos `validate_palette.js --ordinal` di mode terang
  dan gelap. Di mode gelap, arahnya terbalik: makin banyak, makin terang.
- **Tingkat warna kalender** dihitung dari kuartil hari yang tidak nol di setiap baris,
  seperti GitHub. Rentang angkanya tertulis di legenda.

Mode gelap mengikuti pengaturan OS.

## Deploy

Hasil `npm run build` adalah file statis di `build/` dengan `index.html` sebagai fallback
SPA. Bisa dilayani dari CDN atau static host mana pun. Pastikan semua path yang tidak
dikenal diarahkan ke `index.html`.

- Atur `PUBLIC_API_URL` **saat build**, karena nilainya ditanam ke dalam bundle.
- Frontend dan API harus satu site, misalnya `dash.clioilc.com` dan `api.clioilc.com`.
  Di backend, isi `COOKIE_DOMAIN=.clioilc.com`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`,
  dan `CSRF_TRUSTED_ORIGINS` dengan origin frontend.
