import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotes, categorize, toRupiah } from '../js/parser.js';
import { DEFAULT_CATEGORIES as C } from '../js/defaults.js';

test('format angka', () => {
  const cases = [['35000', '', 35000], ['35.000', '', 35000], ['35,000', '', 35000], ['35', 'rb', 35000],
    ['35', 'k', 35000], ['1,5', 'jt', 1500000], ['1.5', 'juta', 1500000], ['1.250.000', '', 1250000],
    ['35', '', 35000], ['2.500', 'rb', 2500000]];
  for (const [n, u, v] of cases) assert.equal(toRupiah(n, u).value, v, `${n}${u}`);
  assert.equal(toRupiah('35', '', { smallNumberThousands: false }).value, 35);
});

test('parse catatan per baris', () => {
  const { entries, skipped } = parseNotes(`Kopi 35000
- Bensin 150rb
Listrik 503.000
Aqua 2 galon 40rb
Rp 87.000 grab food
12/11 Sate 45k
Catatan tanpa angka
+ Bonus 5jt
kopi 25rb, roti 15rb`, { refYear: 2026 });
  const got = entries.map((e) => [e.desc, e.amount]);
  assert.deepEqual(got, [['Kopi', 35000], ['Bensin', 150000], ['Listrik', 503000], ['Aqua 2 galon', 40000],
    ['grab food', 87000], ['Sate', 45000], ['Bonus', 5000000], ['kopi', 25000], ['roti', 15000]]);
  assert.equal(entries[5].date, '2026-11-12');
  assert.equal(entries[6].isIncome, true);
  assert.deepEqual(skipped, ['Catatan tanpa angka']);
});

test('judul tanggal berlaku untuk baris berikutnya', () => {
  const { entries } = parseNotes(`Senin, 10 Nov\nkopi 30rb\n11/11\nmakan siang 50rb`, { refYear: 2026 });
  assert.equal(entries[0].date, '2026-11-10');
  assert.equal(entries[1].date, '2026-11-11');
});

test('kategori dari kata kunci dan hasil belajar', () => {
  assert.equal(categorize('Kopi Kenangan', C).itemId, 'kopi');
  assert.equal(categorize('grab food', C).itemId, 'dining-out');
  assert.equal(categorize('grab ke bandara', C).itemId, 'ojol');
  assert.equal(categorize('Token listrik', C).itemId, 'listrik');
  assert.equal(categorize('Sedekah jumat', C).catId, 'donations');
  assert.equal(categorize('xyz abc', C).source, 'none');
  const learned = { 'mang ujang': { catId: 'food', itemId: 'dining-out' } };
  const r = categorize('Mang Ujang sore', C, learned);
  assert.equal(r.itemId, 'dining-out');
  assert.equal(r.source, 'learned');
});

test('kategori sesuai sheet Groceries & Education', () => {
  assert.equal(categorize('Naga belanja 2 bulanan', C).itemId, 'naga-bulanan');
  assert.equal(categorize('Sabun cuci piring', C).itemId, 'rumah-tangga');
  assert.equal(categorize('Les renang', C).itemId, 'les');
  assert.equal(categorize('Tahsin', C).itemId, 'les');
  assert.equal(categorize('Kumon bulan nov', C).itemId, 'les');
  assert.equal(categorize('Buku tulis', C).itemId, 'buku-atk');
});

test('kategori sesuai sheet Transport & Lain-lain', () => {
  assert.equal(categorize('Cuci mobil', C).itemId, 'cuci-mobil');
  assert.equal(categorize('Tol jagorawi', C).itemId, 'parkir-tol');
  assert.equal(categorize('Perpanjang SIM', C).itemId, 'dokumen');
  assert.equal(categorize('Kado kondangan', C).itemId, 'kado-kondangan');
  assert.equal(categorize('Grab food', C).itemId, 'dining-out');
});
