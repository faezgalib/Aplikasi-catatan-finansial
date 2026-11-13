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
    items: c.items.map(({ fixed, ...it }) => it),
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
  assert.equal(store.getState().version, 2);
  assert.ok(!store.getState().categories.some((c) => c.type === 'fixed'));
  // migrasi tersimpan dan tidak diulang
  assert.equal(JSON.parse(mem.get('catfin.v1')).version, 2);
});

test('centang Fixed cost per item mengubah hasil', () => {
  const st = store.getState();
  st.categories.find((c) => c.id === 'transport').items.find((i) => i.id === 'ojol').fixed = true;
  assert.equal(store.summarize('2026-11').fixedActual, 19326000 + 110000);
});
