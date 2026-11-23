// Versi aplikasi. Naikkan setiap rilis, dan tambahkan ringkasan di CHANGELOG (terbaru di atas).
export const APP_VERSION = '1.5';

export const CHANGELOG = [
  { v: '1.5', date: 'Nov 2026', items: [
    'Foto struk: total belanja dibaca AI (butuh internet & API key), lalu diperiksa sebelum disimpan',
  ] },
  { v: '1.4', date: 'Nov 2026', items: [
    'Tren antar bulan: grafik pemasukan vs pengeluaran, saving ratio, dan perbandingan dengan bulan lalu',
    'Kunci aplikasi dengan PIN 6 digit',
    'Dashboard: ringkasan & diagram di atas, status budget di paling bawah',
    'Pengingat backup dipindah ke Pengaturan',
    'Tidak ada lagi efek tarik-untuk-memuat-ulang saat menggulir',
  ] },
  { v: '1.3', date: 'Nov 2026', items: [
    'Bagikan backup lewat Gmail/WhatsApp/Drive', 'Titik ribuan otomatis', 'Transaksi rutin', 'Status budget', 'Gaji Mbak menjadi Gaji ART',
  ] },
  { v: '1.2', date: 'Nov 2026', items: ['Pembatasan keamanan (Content Security Policy)'] },
  { v: '1.1', date: 'Nov 2026', items: ['Fixed cost per item sesuai rumus Excel', 'Kategori disesuaikan dengan sheet'] },
  { v: '1.0', date: 'Nov 2026', items: ['Rilis pertama: input dari notes, dashboard, budget, export Excel'] },
];
