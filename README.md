# Nihongo Tracker

Aplikasi pencatat belajar bahasa Jepang per chapter, dengan jadwal review otomatis, countdown JLPT, kalender belajar, dan sync antar perangkat.

- Bisa di-install di iPhone, Android, dan laptop (PWA), dan tetap jalan tanpa internet.
- Data utama disimpan di perangkat. Firebase dipakai untuk sync antar perangkat.
- Semua layanan yang dipakai gratis: GitHub Pages untuk hosting, Firebase paket Spark untuk login dan database.

## Pemasangan (sekali saja)

### 1. Firebase
1. Buka [console.firebase.google.com](https://console.firebase.google.com), pilih project-mu.
2. **Authentication → Sign-in method → Email/Password → Enable → Save.**
3. **Firestore Database → Create database** → pilih lokasi (misalnya `asia-southeast2` Jakarta) → mode **production**.
4. Di **Firestore → Rules**, ganti isinya dengan isi file [`firestore.rules`](firestore.rules), lalu **Publish**.
5. **Project settings → General → Your apps → Web app (`</>`)**. Kalau belum ada, buat dulu (tidak perlu Firebase Hosting). Salin isi `firebaseConfig` ke file [`firebase-config.js`](firebase-config.js).

### 2. GitHub Pages
1. Di repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. Branch: **main**, folder: **/ (root)** → **Save**.
3. Tunggu 1–2 menit. Aplikasi bisa dibuka di `https://<username>.github.io/<nama-repo>/`.

### 3. Install di perangkat
- **iPhone/iPad:** buka link di **Safari** → tombol Share → **Add to Home Screen**. Selalu buka aplikasi dari ikon ini, supaya iOS tidak menghapus datanya.
- **Android:** buka di Chrome → menu ⋮ → **Install app**.
- **Laptop:** buka di Chrome/Edge → ikon install di address bar.

Setelah itu buka **Settings → Create account** (email + password) di perangkat pertama, lalu **Sign in** dengan akun yang sama di perangkat lain.

## Cadangan data
Settings → **Backup (JSON)** sebulan sekali, lalu simpan file-nya di Google Drive. File ini bisa dipulihkan lewat **Restore from backup**, termasuk kalau suatu saat pindah ke layanan lain.

## Struktur file
| File | Isi |
|---|---|
| `index.html`, `styles.css` | Tampilan |
| `app.js` | Logika aplikasi: jadwal review, tampilan, penyimpanan lokal |
| `sync.js` | Login dan sync dengan Firebase |
| `firebase-config.js` | Konfigurasi project Firebase |
| `firestore.rules` | Aturan keamanan: setiap akun hanya bisa membaca datanya sendiri |
| `sw.js`, `manifest.webmanifest`, `icons/` | Supaya bisa di-install dan dipakai offline |

Setiap kali kode diubah, naikkan `CACHE` di `sw.js` (misalnya `nt-v1.0.1`) supaya perangkat mengambil versi baru.
