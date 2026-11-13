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
      { id: 'housing-other', name: 'Other', budget: 0, keywords: [] },
    ],
  },  {
    id: 'transport', name: 'Transport', type: 'fixed', items: [
      { id: 'bensin', name: 'Bensin', budget: 1500000, keywords: ['bensin', 'pertalite', 'pertamax', 'shell', 'bbm', 'solar', 'isi bensin'] },
      { id: 'cuci-mobil', name: 'Cuci Mobil', budget: 150000, keywords: ['cuci mobil', 'cuci motor', 'car wash'] },
      { id: 'ojol', name: 'Online (Ojek / Taksi Online)', budget: 0, keywords: ['online', 'gojek', 'grab', 'goride', 'gocar', 'grabcar', 'maxim', 'taksi', 'taxi', 'ojek', 'ojol', 'bluebird'] },
      { id: 'parkir-tol', name: 'Toll & Parkir', budget: 200000, keywords: ['tol', 'toll', 'etoll', 'e-toll', 'flazz', 'parkir'] },
      { id: 'pajak-kendaraan', name: 'Tax (Pajak Kendaraan)', budget: 0, keywords: ['pajak motor', 'pajak mobil', 'pajak kendaraan', 'samsat', 'pkb'] },
      { id: 'servis-kendaraan', name: 'Maintenance', budget: 0, keywords: ['servis motor', 'servis mobil', 'service motor', 'service mobil', 'ganti oli', 'oli', 'ban', 'bengkel', 'aki'] },
      { id: 'dokumen', name: 'Other, SIM, STNK, Passport', budget: 0, keywords: ['sim', 'stnk', 'paspor', 'passport', 'bpkb'] },
    ],
  },  {
    id: 'others', name: 'Lain-lain', type: 'variable', items: [
      { id: 'kado-kondangan', name: 'Kado Kondangan', budget: 0, keywords: ['kado', 'kondangan', 'nikahan', 'hadiah', 'sumbangan'] },
      { id: 'arisan', name: 'Arisan', budget: 750000, keywords: ['arisan'] },
      { id: 'nyukur', name: 'Nyukur', budget: 0, keywords: ['nyukur', 'cukur', 'potong rambut', 'barbershop', 'pangkas'] },
      { id: 'others-other', name: 'Lainnya', budget: 0, keywords: [] },
    ],
  },  {
    id: 'food', name: 'Food & Beverage', type: 'food', items: [
      { id: 'bahan-pokok', name: 'Bahan Pokok ke Pasar (beras, daging, telur)', budget: 1500000, keywords: ['pasar', 'beras', 'daging', 'telur', 'ayam', 'ikan', 'sayur', 'sayuran', 'bumbu', 'minyak goreng', 'tahu', 'tempe', 'roti', 'susu', 'buah'] },
      { id: 'dining-out', name: 'Dining Out / Order Online', budget: 2000000, keywords: ['makan', 'gofood', 'go food', 'grabfood', 'grab food', 'shopeefood', 'shopee food', 'resto', 'restoran', 'warung', 'bakso', 'nasi', 'padang', 'sate', 'mie', 'mcd', 'kfc', 'pizza', 'burger', 'martabak', 'soto', 'seafood', 'lunch', 'dinner', 'sarapan'] },
      { id: 'kopi', name: 'Kopi', budget: 200000, keywords: ['kopi', 'coffee', 'starbucks', 'kopken', 'kopi kenangan', 'janji jiwa', 'fore', 'tomoro', 'latte', 'americano'] },
    ],
  },  {
    id: 'pets', name: 'Pets', type: 'variable', items: [
      { id: 'pakan', name: 'Food (Pakan)', budget: 200000, keywords: ['pakan', 'makanan kura', 'pelet', 'pellet', 'mazuri', 'kangkung'] },
      { id: 'substrat', name: 'Coco Husk, Timothy Hay', budget: 100000, keywords: ['coco husk', 'cocohusk', 'timothy', 'hay', 'substrat'] },
      { id: 'vet-hotel', name: 'Hotel / Vet', budget: 0, keywords: ['vet', 'dokter hewan', 'pet hotel', 'penitipan hewan', 'lampu uvb', 'uvb'] },
    ],
  },  {
    id: 'personal', name: 'Personal Care', type: 'variable', items: [
      { id: 'medical', name: 'Medical', budget: 500000, keywords: ['dokter', 'drg', 'dokter gigi', 'obat', 'apotek', 'apotik', 'klinik', 'rumah sakit', 'rs', 'lab', 'medical'] },
      { id: 'fitness', name: 'Fitness Stuff (Protein, Dumbbell, Creatine)', budget: 500000, keywords: ['protein', 'whey', 'dumbbell', 'creatine', 'gym', 'barbel', 'resistance band'] },
      { id: 'clothing', name: 'Clothing', budget: 0, keywords: ['baju', 'celana', 'kaos', 'kemeja', 'gesper', 'jaket', 'levis', "levi's", 'uniqlo', 'pakaian'] },
      { id: 'running', name: 'Running Stuff (shoes, race, shirt)', budget: 0, keywords: ['sepatu lari', 'running', 'lari', 'race', 'marathon', 'half marathon', 'hm', 'jersey', 'sepatu futsal', 'futsal', 'strava', 'suunto', 'garmin', 'energy gel', 'gel'] },
      { id: 'skincare', name: 'Bedak, Sabun Muka, Waxing', budget: 500000, keywords: ['bedak', 'sabun muka', 'facial wash', 'skincare', 'waxing', 'sunscreen', 'pelembab', 'parfum', 'deodoran'] },
      { id: 'vitamin', name: 'Vitamin', budget: 0, keywords: ['vitamin', 'suplemen', 'omega', 'multivitamin', 'zinc'] },
      { id: 'membership', name: 'Membership (Pilates, dll)', budget: 300000, keywords: ['membership', 'pilates', 'yoga', 'member gym'] },
    ],
  },  {
    id: 'entertainment', name: 'Entertainment', type: 'variable', items: [
      { id: 'playground', name: 'Playground', budget: 500000, keywords: ['playground', 'timezone', 'kidzania', 'mainan mall', 'kolam renang', 'berenang'] },
      { id: 'movies', name: 'Movies / Cineplex', budget: 500000, keywords: ['bioskop', 'cinema', 'cineplex', 'xxi', 'cgv', 'nonton', 'tiket film'] },
      { id: 'mainan-anak', name: 'Belanja Mainan Anak', budget: 0, keywords: ['mainan', 'lego', 'toys', 'hotwheels', 'hot wheels'] },
      { id: 'subscriptions', name: 'Subscriptions (YouTube, Vidio, AI)', budget: 300000, keywords: ['youtube', 'netflix', 'vidio', 'spotify', 'disney', 'chatgpt', 'claude', 'langganan', 'subscription', 'icloud', 'google one'] },
      { id: 'pulsa', name: 'Paket Data HP & Pulsa', budget: 400000, keywords: ['pulsa', 'paket data', 'kuota', 'telkomsel', 'xl', 'indosat', 'smartfren'] },
      { id: 'barang-entertainment', name: 'Belanja Barang Entertainment', budget: 0, keywords: ['game', 'steam', 'playstation', 'buku novel'] },
    ],
  },  {
    id: 'groceries', name: 'Groceries', type: 'food', items: [
      { id: 'rumah-tangga', name: 'Kebutuhan Rumah: Sabun dll (selain makanan)', budget: 2000000, keywords: ['sabun', 'sabun cuci', 'deterjen', 'detergen', 'tisu', 'tissue', 'pampers', 'popok', 'shampoo', 'sampo', 'pasta gigi', 'odol', 'sunlight', 'rinso', 'pewangi', 'pembersih', 'cleaning wipes', 'kebutuhan rumah'] },
      { id: 'naga-bulanan', name: 'Naga Belanja 2 Bulanan', budget: 0, keywords: ['naga', 'belanja bulanan', 'belanja 2 bulanan', 'indomaret', 'alfamart', 'alfamidi', 'superindo', 'hypermart', 'transmart', 'lotte', 'giant', 'hero', 'ranch market', 'supermarket'] },
    ],
  },  {
    id: 'education', name: 'Education', type: 'fixed', items: [
      { id: 'spp', name: 'Sekolah Anak Plus DKS 1 tahun, Masuk SD', budget: 2400000, keywords: ['spp', 'uang sekolah', 'sekolah', 'dks', 'masuk sd', 'uang pangkal', 'daycare'] },
      { id: 'les', name: 'Les (renang, Kumon, Miss Vee, Tahsin dll)', budget: 4790000, keywords: ['les', 'les renang', 'kumon', 'miss vee', 'tahsin', 'kursus', 'bimbel', 'course', 'udemy'] },
      { id: 'buku-atk', name: 'Beli buku atau barang sejenis', budget: 0, keywords: ['buku', 'atk', 'alat tulis', 'pensil', 'seragam'] },
      { id: 'fotokopi', name: 'Photocopy, Print', budget: 0, keywords: ['fotokopi', 'fotocopy', 'photocopy', 'print', 'cetak', 'jilid'] },
    ],
  },  {
    id: 'savings', name: 'Savings / Investments', type: 'saving', items: [
      { id: 'tabungan', name: 'Nabung di Awal ke Rekening Terpisah', budget: 20000000, keywords: ['nabung', 'tabung', 'tabungan', 'rekening terpisah', 'transfer tabungan'] },
      { id: 'investasi', name: 'Investasi (Emas dll)', budget: 500000, keywords: ['investasi', 'emas', 'antam', 'logam mulia', 'reksadana', 'reksa dana', 'saham', 'deposito', 'sbn', 'sukuk', 'crypto', 'bitcoin'] },
    ],
  },  {
    id: 'donations', name: 'Presents & Donations', type: 'variable', items: [
      { id: 'sedekah', name: 'Sedekah', budget: 7000000, keywords: ['sedekah', 'infaq', 'infak', 'zakat', 'donasi', 'masjid', 'wakaf', 'santunan', 'yatim'] },
      { id: 'tahseel', name: 'Tahseel', budget: 0, keywords: ['tahseel'] },
    ],
  },  {
    id: 'unexpected', name: 'Pengeluaran Tak Terduga', type: 'variable', items: [
      { id: 'jajan-sekolah', name: 'Jajan Sekolah Anak, Catering', budget: 0, keywords: ['jajan', 'catering', 'katering', 'uang saku', 'bekal'] },
      { id: 'perabot', name: 'Perabot (Meja Belajar, dll)', budget: 0, keywords: ['meja', 'kursi', 'lemari', 'kasur', 'rak', 'perabot', 'ikea', 'informa'] },
      { id: 'online-shop', name: 'Belanja Online (Shopee, Tokopedia)', budget: 0, keywords: ['shopee', 'tokopedia', 'tokped', 'lazada', 'tiktok shop', 'blibli'] },
      { id: 'kondangan', name: 'Kondangan, Kado (tak terduga)', budget: 0, keywords: ['melayat', 'takziah'] },
      { id: 'unexpected-other', name: 'Lainnya', budget: 0, keywords: [] },
    ],
  },];

export const CATEGORY_TYPES = {
  fixed: 'Biaya tetap (non-makanan)',
  food: 'Makanan & groceries',
  saving: 'Tabungan / investasi',
  variable: 'Variabel',
};
