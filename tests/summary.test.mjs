import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage tiruan untuk Node
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.alert = () => {};

const { DEFAULT_CATEGORIES } = await import('../js/defaults.js');
const store = await import('../js/store.js');

// Data aktual November dari sheet (sel D dan I yang dipakai rumus Fixed Cost + sisanya)
const NOV = {
  mortgage: 10000000, 'gaji-mbak': 2000000, listrik: 503000, galon: 138000, keamanan: 300000,
  'housing-other': 55000, bensin: 1100000, 'cuci-mobil': 40000, ojol: 110000, 'parkir-tol': 50000,
  'kado-kondangan': 250000, arisan: 125000, nyukur: 115000,
  'bahan-pokok': 847000, 'dining-out': 2305000, 'rumah-tangga': 612000,
  spp: 2400000, les: 2710000, fotokopi: 54000, tabungan: 25000000,
};

function v1State() {
  // Bentuk data versi lama: tanpa flag fixed, kategori Housing/Transport/Education bertipe 'fixed'
  const cats = structuredClone(DEFAULT_CATEGORIES).map((c) => ({
    ...c,
    type: ['housing', 'transport', 'education'].includes(c.id) ? 'fixed' : c.type,
    items: c.items.map(({ fixed, recurring, ...it }) => (it.id === 'gaji-mbak' ? { ...it, name: 'Gaji Mbak' } : it)),
    overIsGood: undefined,
  }));
  const catOf = (itemId) => cats.find((c) => c.items.some((i) => i.id === itemId)).id;
  return {
    version: 1,
    settings: {},
    categories: cats,
    months: { '2026-11': { budget: {}, income: [{ id: 'i1', name: 'Income 1', projected: 70000000, actual: 70000000 }], prevBalance: 0 } },
    transactions: Object.entries(NOV).map(([itemId, amount], n) => ({ id: 't' + n, month: '2026-11', itemId, catId: catOf(itemId), amount, desc: itemId })),
    learned: {},
  };
}

test('migrasi data lama + Fixed Cost sama dengan rumus Excel (Rp19.326.000)', () => {
  mem.set('catfin.v1', JSON.stringify(v1State()));
  store.load();
  const s = store.summarize('2026-11');
  assert.equal(s.fixedActual, 19326000);
  assert.equal(s.foodActual, 3764000); // Food & Beverage 3.152.000 + Groceries 612.000
  assert.equal(Math.round(s.savingRatio * 100), 36);
  assert.equal(store.getState().version, 3);
  assert.ok(!store.getState().categories.some((c) => c.type === 'fixed'));
  // migrasi tersimpan dan tidak diulang
  assert.equal(JSON.parse(mem.get('catfin.v1')).version, 3);
});

test('centang Fixed cost per item mengubah hasil', () => {
  const st = store.getState();
  st.categories.find((c) => c.id === 'transport').items.find((i) => i.id === 'ojol').fixed = true;
  assert.equal(store.summarize('2026-11').fixedActual, 19326000 + 110000);
});

test('migrasi v3: Gaji ART, item rutin, kategori "melebihi = baik"', () => {
  const st = store.getState();
  const item = (id) => st.categories.flatMap((c) => c.items).find((i) => i.id === id);
  assert.equal(item('gaji-mbak').name, 'Gaji ART');
  const rec = st.categories.flatMap((c) => c.items).filter((i) => i.recurring).map((i) => i.id).sort();
  assert.deepEqual(rec, ['arisan', 'gaji-mbak', 'keamanan', 'mortgage', 'wifi']);
  assert.deepEqual(st.categories.filter((c) => c.overIsGood).map((c) => c.id).sort(), ['donations', 'savings']);
});

test('status budget: tabungan & donasi melebihi = hijau, lainnya kuning/merah', () => {
  const st = store.getState();
  const m = store.ensureMonth('2026-11');
  Object.assign(m.budget, { 'dining-out': 1000000, 'bahan-pokok': 1000000, kopi: 0, tabungan: 20000000, sedekah: 1000000 });
  st.transactions.push({ id: 'x1', month: '2026-11', catId: 'donations', itemId: 'sedekah', amount: 1500000, desc: 'sedekah' });
  const res = store.budgetStatus(store.summarize('2026-11'));
  const by = Object.fromEntries(res.map((r) => [r.id, r.level]));
  assert.equal(by.food, 'bad');        // 3.152.000 dari 2.000.000
  assert.equal(by.savings, 'good');    // 25 jt dari 20 jt
  assert.equal(by.donations, 'good');  // 1,5 jt dari 1 jt
  assert.equal(by.others, 'nobudget'); // ada pengeluaran, proyeksi 0
  assert.ok(!res.some((r) => r.id === 'housing' && r.level === 'good'));
  st.transactions = st.transactions.filter((t) => t.id !== 'x1');
});

test('transaksi rutin memakai aktual bulan lalu, atau proyeksi bila belum ada', () => {
  const rows = store.recurringEntries('2026-12');
  const by = Object.fromEntries(rows.map((r) => [r.itemId, r.amount]));
  assert.equal(by.mortgage, 10000000);   // aktual November
  assert.equal(by.arisan, 125000);       // aktual November
  assert.equal(rows.find((r) => r.itemId === 'gaji-mbak').desc, 'Gaji ART');
  assert.equal(rows.length, 5);
});
