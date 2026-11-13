// Kategori awal, disusun mengikuti template Excel "Personal monthly budget".
// type: 'fixed' = biaya tetap (non-makanan), 'food' = makan & groceries,
//       'saving' = tabungan/investasi, 'variable' = lainnya.
// budget = proyeksi bulanan awal (Rp). keywords = kata kunci untuk mengenali catatan.

export const DEFAULT_CATEGORIES = [
  {
    id: 'housing', name: 'Housing', type: 'fixed', items: [
      { id: 'mortgage', name: 'Mortgage / KPR', budget: 10000000, keywords: ['mortgage', 'kpr', 'cicilan rumah'] },
      { id: 'gaji-mbak', name: 'Gaji Mbak', budget: 2000000, keywords: ['gaji mbak', 'mbak', 'art', 'asisten rumah tangga', 'pembantu'] },
      { id: 'listrik', name: 'Listrik', budget: 1500000, keywords: ['listrik', 'pln', 'token listrik', 'token'] },
      { id: 'gas', name: 'Gas Elpiji', budget: 0, keywords: ['gas', 'elpiji', 'lpg'] },
      { id: 'galon', name: 'Air Galon', budget: 300000, keywords: ['galon', 'air galon', 'aqua galon', 'le minerale galon'] },
      { id: 'wifi', name: 'Wifi', budget: 376000, keywords: ['wifi', 'indihome', 'biznet', 'firstmedia', 'first media', 'myrepublic', 'internet rumah'] },
      { id: 'keamanan', name: 'Keamanan / Iuran', budget: 300000, keywords: ['keamanan', 'satpam', 'iuran', 'ipl', 'iuran rt', 'sampah'] },
      { id: 'maintenance', name: 'Maintenance / Perbaikan', budget: 0, keywords: ['maintenance', 'perbaikan', 'servis ac', 'service ac', 'tukang', 'renovasi', 'ledeng'] },
      { id: 'laundry', name: 'Laundry', budget: 0, keywords: ['laundry', 'londri', 'cuci baju', 'dry clean'] },
      { id: 'housing-other', name: 'Lainnya', budget: 0, keywords: [] },
    ],
  },
  {
    id: 'transport', name: 'Transportasi', type: 'fixed', items: [
      { id: 'bensin', name: 'Bensin', budget: 0, keywords: ['bensin', 'pertalite', 'pertamax', 'shell', 'bbm', 'solar'] },
      { id: 'parkir-tol', name: 'Parkir & Tol', budget: 0, keywords: ['parkir', 'tol', 'etoll', 'e-toll', 'flazz'] },
      { id: 'ojol', name: 'Ojek / Taksi Online', budget: 0, keywords: ['gojek', 'grab', 'goride', 'gocar', 'grabcar', 'maxim', 'taksi', 'taxi', 'ojek', 'bluebird'] },
      { id: 'servis-kendaraan', name: 'Servis Kendaraan', budget: 0, keywords: ['servis motor', 'servis mobil', 'service motor', 'service mobil', 'ganti oli', 'oli', 'ban', 'cuci mobil', 'cuci motor'] },
    ],
  },
  {
    id: 'entertainment', name: 'Entertainment', type: 'variable', items: [
      { id: 'playground', name: 'Playground', budget: 500000, keywords: ['playground', 'timezone', 'kidzania', 'mainan mall', 'kolam renang', 'berenang'] },
      { id: 'movies', name: 'Movies / Cineplex', budget: 500000, keywords: ['bioskop', 'cinema', 'cineplex', 'xxi', 'cgv', 'nonton', 'tiket film'] },
      { id: 'mainan-anak', name: 'Belanja Mainan Anak', budget: 0, keywords: ['mainan', 'lego', 'toys', 'hotwheels', 'hot wheels'] },
      { id: 'subscriptions', name: 'Subscriptions (YouTube, Vidio, AI)', budget: 300000, keywords: ['youtube', 'netflix', 'vidio', 'spotify', 'disney', 'chatgpt', 'claude', 'langganan', 'subscription', 'icloud', 'google one'] },
      { id: 'pulsa', name: 'Paket Data HP & Pulsa', budget: 400000, keywords: ['pulsa', 'paket data', 'kuota', 'telkomsel', 'xl', 'indosat', 'smartfren'] },
      { id: 'barang-entertainment', name: 'Belanja Barang Entertainment', budget: 0, keywords: ['game', 'steam', 'playstation', 'buku novel'] },
    ],
  },
  {
    id: 'groceries', name: 'Groceries', type: 'food', items: [
      { id: 'supermarket', name: 'Supermarket / Minimarket', budget: 0, keywords: ['indomaret', 'alfamart', 'alfamidi', 'superindo', 'hypermart', 'transmart', 'lotte', 'giant', 'hero', 'ranch market', 'belanja bulanan', 'supermarket'] },
      { id: 'rumah-tangga', name: 'Kebutuhan Rumah Tangga', budget: 0, keywords: ['sabun', 'deterjen', 'detergen', 'tisu', 'tissue', 'pampers', 'popok', 'shampoo', 'sampo', 'pasta gigi', 'odol', 'sunlight', 'rinso'] },
      { id: 'buah-snack', name: 'Buah & Snack', budget: 0, keywords: ['buah', 'snack', 'cemilan', 'camilan', 'roti', 'susu'] },
    ],
  },
  {
    id: 'education', name: 'Education', type: 'fixed', items: [
      { id: 'spp', name: 'SPP / Uang Sekolah', budget: 0, keywords: ['spp', 'uang sekolah', 'sekolah', 'uang pangkal', 'daycare'] },
      { id: 'les', name: 'Les / Kursus', budget: 0, keywords: ['les', 'kursus', 'bimbel', 'course', 'udemy'] },
      { id: 'buku-atk', name: 'Buku & Alat Tulis', budget: 0, keywords: ['buku', 'atk', 'alat tulis', 'pensil', 'seragam'] },
      { id: 'fotokopi', name: 'Photocopy, Print', budget: 0, keywords: ['fotokopi', 'fotocopy', 'photocopy', 'print', 'cetak', 'jilid'] },
    ],
  },
  {
    id: 'food', name: 'Food & Beverage', type: 'food', items: [
      { id: 'bahan-pokok', name: 'Bahan Pokok ke Pasar (beras, daging, telur)', budget: 1500000, keywords: ['pasar', 'beras', 'daging', 'telur', 'ayam', 'ikan', 'sayur', 'sayuran', 'bumbu', 'minyak goreng', 'tahu', 'tempe'] },
      { id: 'dining-out', name: 'Dining Out / Order Online', budget: 2000000, keywords: ['makan', 'gofood', 'go food', 'grabfood', 'grab food', 'shopeefood', 'shopee food', 'resto', 'restoran', 'warung', 'bakso', 'nasi', 'padang', 'sate', 'mie', 'mcd', 'kfc', 'pizza', 'burger', 'martabak', 'soto', 'seafood', 'lunch', 'dinner', 'sarapan'] },
      { id: 'kopi', name: 'Kopi', budget: 200000, keywords: ['kopi', 'coffee', 'starbucks', 'kopken', 'kopi kenangan', 'janji jiwa', 'fore', 'tomoro', 'latte', 'americano'] },
    ],
  },
  {
    id: 'pets', name: 'Pets', type: 'variable', items: [
      { id: 'pakan', name: 'Pakan', budget: 200000, keywords: ['pakan', 'makanan kura', 'pelet', 'pellet', 'mazuri', 'kangkung'] },
      { id: 'substrat', name: 'Coco Husk, Timothy Hay', budget: 100000, keywords: ['coco husk', 'cocohusk', 'timothy', 'hay', 'substrat'] },
      { id: 'vet-hotel', name: 'Vet / Pet Hotel', budget: 0, keywords: ['vet', 'dokter hewan', 'pet hotel', 'penitipan hewan', 'lampu uvb', 'uvb'] },
    ],
  },
  {
    id: 'personal', name: 'Personal Care', type: 'variable', items: [
      { id: 'medical', name: 'Medical', budget: 500000, keywords: ['dokter', 'drg', 'dokter gigi', 'obat', 'apotek', 'apotik', 'klinik', 'rumah sakit', 'rs', 'lab', 'medical'] },
      { id: 'fitness', name: 'Fitness Stuff (Protein, Dumbbell, Creatine)', budget: 500000, keywords: ['protein', 'whey', 'dumbbell', 'creatine', 'gym', 'barbel', 'resistance band'] },
      { id: 'clothing', name: 'Clothing', budget: 0, keywords: ['baju', 'celana', 'kaos', 'kemeja', 'gesper', 'jaket', 'levis', "levi's", 'uniqlo', 'pakaian'] },
      { id: 'running', name: 'Running Stuff (shoes, race, shirt)', budget: 0, keywords: ['sepatu lari', 'running', 'lari', 'race', 'marathon', 'half marathon', 'hm', 'jersey', 'sepatu futsal', 'futsal', 'strava', 'suunto', 'garmin', 'energy gel', 'gel'] },
      { id: 'skincare', name: 'Bedak, Sabun Muka, Waxing', budget: 500000, keywords: ['bedak', 'sabun muka', 'facial wash', 'skincare', 'waxing', 'sunscreen', 'pelembab', 'parfum', 'deodoran'] },
      { id: 'vitamin', name: 'Vitamin', budget: 0, keywords: ['vitamin', 'suplemen', 'omega', 'multivitamin', 'zinc'] },
      { id: 'membership', name: 'Membership (Pilates, dll)', budget: 300000, keywords: ['membership', 'pilates', 'yoga', 'member gym'] },
    ],
  },
  {
    id: 'savings', name: 'Savings / Investments', type: 'saving', items: [
      { id: 'tabungan', name: 'Nabung di Awal ke Rekening Terpisah', budget: 20000000, keywords: ['nabung', 'tabung', 'tabungan', 'rekening terpisah', 'transfer tabungan'] },
      { id: 'investasi', name: 'Investasi (Emas dll)', budget: 500000, keywords: ['investasi', 'emas', 'antam', 'logam mulia', 'reksadana', 'reksa dana', 'saham', 'deposito', 'sbn', 'sukuk', 'crypto', 'bitcoin'] },
    ],
  },
  {
    id: 'donations', name: 'Presents & Donations', type: 'variable', items: [
      { id: 'sedekah', name: 'Sedekah', budget: 7000000, keywords: ['sedekah', 'infaq', 'infak', 'zakat', 'donasi', 'masjid', 'wakaf', 'santunan', 'yatim'] },
      { id: 'tahseel', name: 'Tahseel', budget: 0, keywords: ['tahseel', 'tahsin', 'ngaji', 'mengaji', 'tpa', 'ustadz', 'ustad'] },
    ],
  },
  {
    id: 'others', name: 'Lain-lain', type: 'variable', items: [
      { id: 'arisan', name: 'Arisan', budget: 750000, keywords: ['arisan'] },
      { id: 'nyukur', name: 'Nyukur / Potong Rambut', budget: 0, keywords: ['nyukur', 'cukur', 'potong rambut', 'barbershop', 'pangkas'] },
      { id: 'others-other', name: 'Lainnya', budget: 0, keywords: [] },
    ],
  },
  {
    id: 'unexpected', name: 'Pengeluaran Tak Terduga', type: 'variable', items: [
      { id: 'jajan-sekolah', name: 'Jajan Sekolah Anak, Catering', budget: 0, keywords: ['jajan', 'catering', 'katering', 'uang saku', 'bekal'] },
      { id: 'perabot', name: 'Perabot (Meja Belajar, dll)', budget: 0, keywords: ['meja', 'kursi', 'lemari', 'kasur', 'rak', 'perabot', 'ikea', 'informa'] },
      { id: 'online-shop', name: 'Belanja Online (Shopee, Tokopedia)', budget: 0, keywords: ['shopee', 'tokopedia', 'tokped', 'lazada', 'tiktok shop', 'blibli'] },
      { id: 'kondangan', name: 'Kondangan, Kado', budget: 0, keywords: ['kondangan', 'kado', 'hadiah', 'nikahan', 'sumbangan', 'melayat', 'takziah'] },
      { id: 'unexpected-other', name: 'Lainnya', budget: 0, keywords: [] },
    ],
  },
];

export const CATEGORY_TYPES = {
  fixed: 'Biaya tetap (non-makanan)',
  food: 'Makanan & groceries',
  saving: 'Tabungan / investasi',
  variable: 'Variabel',
};
