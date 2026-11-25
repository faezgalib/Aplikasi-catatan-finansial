// Penyimpanan data di localStorage (data hanya ada di perangkat ini).
import { DEFAULT_CATEGORIES, DEFAULT_FIXED_ITEMS, DEFAULT_RECURRING_ITEMS, DEFAULT_GOOD_CATEGORIES } from './defaults.js';

const KEY = 'catfin.v1';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function defaultBudget(categories) {
  const b = {};
  for (const c of categories) for (const it of c.items) if (it.budget) b[it.id] = it.budget;
  return b;
}

function freshState() {
  const categories = structuredClone(DEFAULT_CATEGORIES);
  return {
    version: 3,
    settings: { apiKey: '', smallNumberThousands: true, aiMode: 'unknown', lastBackupAt: null, lang: 'en', numberFormat: 'dot' },
    categories,
    months: {},
    transactions: [],
    learned: {},
  };
}

let state;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? JSON.parse(raw) : freshState();
  } catch {
    state = freshState();
  }
  state.settings = { ...freshState().settings, ...(state.settings || {}) };
  state.learned ||= {};
  state.transactions ||= [];
  state.months ||= {};
  migrate();
  return state;
}

function migrate() {
  const v = state.version || 1;
  // v1 -> v2: fixed cost ditandai per item (bukan per kategori), sesuai rumus Excel.
  if (v < 2) {
    const ids = new Set(DEFAULT_FIXED_ITEMS);
    for (const c of state.categories || []) {
      if (c.type === 'fixed') c.type = 'variable';
      for (const it of c.items) if (it.fixed === undefined) it.fixed = ids.has(it.id);
    }
  }
  // v2 -> v3: transaksi rutin per item, "melebihi = baik" per kategori, Gaji Mbak -> Gaji ART.
  if (v < 3) {
    const rec = new Set(DEFAULT_RECURRING_ITEMS);
    const good = new Set(DEFAULT_GOOD_CATEGORIES);
    for (const c of state.categories || []) {
      if (c.overIsGood === undefined) c.overIsGood = good.has(c.id);
      for (const it of c.items) {
        if (it.recurring === undefined) it.recurring = rec.has(it.id);
        if (it.id === 'gaji-mbak' && it.name === 'Gaji Mbak') it.name = 'Gaji ART';
      }
    }
  }
  if (v < 3) {
    state.version = 3;
    save();
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    alert('Gagal menyimpan data: ' + e.message);
    return false;
  }
}

export const getState = () => state;

/** Ambil data bulan; jika belum ada, salin proyeksi & pemasukan dari bulan sebelumnya. */
export function ensureMonth(key) {
  if (state.months[key]) return state.months[key];
  const prevKeys = Object.keys(state.months).filter((k) => k < key).sort();
  const prev = prevKeys.length ? state.months[prevKeys[prevKeys.length - 1]] : null;
  state.months[key] = prev
    ? {
        budget: { ...prev.budget },
        income: prev.income.map((i) => ({ id: uid(), name: i.name, projected: i.projected, actual: 0 })),
        prevBalance: 0,
        note: '',
      }
    : {
        budget: defaultBudget(state.categories),
        income: [{ id: uid(), name: 'Income 1', projected: 0, actual: 0 }],
        prevBalance: 0,
        note: '',
      };
  save();
  return state.months[key];
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.categories) || !Array.isArray(data.transactions)) {
    throw new Error('File bukan backup aplikasi ini.');
  }
  localStorage.setItem(KEY, JSON.stringify(data));
  load();
}

export function resetAll() {
  state = freshState();
  save();
}

export function findItem(catId, itemId) {
  const c = state.categories.find((x) => x.id === catId);
  return { cat: c, item: c?.items.find((i) => i.id === itemId) };
}

/** Ringkasan satu bulan, dengan definisi yang sama dengan template Excel. */
export function summarize(key) {
  const m = ensureMonth(key);
  const tx = state.transactions.filter((t) => t.month === key);
  const actualByItem = {};
  for (const t of tx) actualByItem[t.itemId] = (actualByItem[t.itemId] || 0) + t.amount;

  const cats = state.categories.map((c) => {
    const items = c.items.map((it) => {
      const projected = Number(m.budget[it.id] || 0);
      const actual = actualByItem[it.id] || 0;
      return { ...it, projected, actual, diff: projected - actual };
    });
    const projected = items.reduce((s, i) => s + i.projected, 0);
    const actual = items.reduce((s, i) => s + i.actual, 0);
    return { id: c.id, name: c.name, type: c.type, items, projected, actual, diff: projected - actual };
  });

  const incomeProjected = m.income.reduce((s, i) => s + Number(i.projected || 0), 0);
  const incomeActual = m.income.reduce((s, i) => s + Number(i.actual || 0), 0);
  const totalProjected = cats.reduce((s, c) => s + c.projected, 0);
  const totalActual = cats.reduce((s, c) => s + c.actual, 0);
  const byType = (type) => cats.filter((c) => c.type === type).reduce((s, c) => s + c.actual, 0);
  const ratio = (v) => (incomeActual > 0 ? v / incomeActual : null);
  const fixedItems = cats.flatMap((c) => c.items.filter((i) => i.fixed));
  const fixedActual = fixedItems.reduce((a, i) => a + i.actual, 0);
  const fixedProjected = fixedItems.reduce((a, i) => a + i.projected, 0);
  const foodActual = byType('food');

  return {
    key, month: m, cats, tx,
    incomeProjected, incomeActual, totalProjected, totalActual,
    expenseDiff: totalProjected - totalActual,
    balance: incomeActual - totalActual,
    projectedBalance: incomeProjected - totalProjected,
    balanceDiff: (incomeActual - totalActual) - (incomeProjected - totalProjected),
    savingRatio: ratio(byType('saving')),
    fixedActual, fixedProjected,
    fixedRatio: ratio(fixedActual),
    foodActual,
    foodRatio: ratio(foodActual),
    savingActual: byType('saving'),
  };
}

/**
 * Status budget per kategori untuk peringatan di Dashboard.
 * level: 'bad' (>=100%), 'warn' (>=80%), 'good' (kategori "melebihi = baik" yang lewat 100%),
 *        'nobudget' (ada pengeluaran tapi proyeksi 0).
 */
export function budgetStatus(summary, warnAt = 0.8) {
  const cats = state.categories;
  const out = [];
  for (const c of summary.cats) {
    const good = !!cats.find((x) => x.id === c.id)?.overIsGood;
    if (!c.projected) {
      if (c.actual > 0 && !good) out.push({ id: c.id, name: c.name, level: 'nobudget', actual: c.actual, projected: 0, ratio: null });
      continue;
    }
    const ratio = c.actual / c.projected;
    let level = null;
    if (good) level = ratio > 1 ? 'good' : null;
    else if (ratio >= 1) level = 'bad';
    else if (ratio >= warnAt) level = 'warn';
    if (level) out.push({ id: c.id, name: c.name, level, actual: c.actual, projected: c.projected, ratio });
  }
  const order = { bad: 0, warn: 1, good: 2, nobudget: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (b.ratio ?? 0) - (a.ratio ?? 0));
}

/** Daftar transaksi rutin untuk bulan `key`: nominal = aktual bulan sebelumnya, atau proyeksi bila belum ada. */
export function recurringEntries(key) {
  const m = ensureMonth(key);
  const [y, mo] = key.split('-').map(Number);
  const prevKey = monthKey(new Date(y, mo - 2, 1));
  const prevActual = {};
  for (const t of state.transactions) if (t.month === prevKey) prevActual[t.itemId] = (prevActual[t.itemId] || 0) + t.amount;
  const rows = [];
  for (const c of state.categories) {
    for (const it of c.items) {
      if (!it.recurring) continue;
      rows.push({ catId: c.id, itemId: it.id, desc: it.name, amount: prevActual[it.id] || Number(m.budget[it.id] || 0) });
    }
  }
  return rows;
}

export function markBackup() {
  state.settings.lastBackupAt = new Date().toISOString();
  save();
}

/**
 * Tren beberapa bulan terakhir sampai `endKey`. Bulan di awal yang belum punya data dilewati.
 * @returns {Array<{key, income, expense, savingRatio, fixed}>}
 */
export function trend(endKey, n = 12) {
  const [y, m] = endKey.split('-').map(Number);
  const keys = [];
  for (let i = n - 1; i >= 0; i--) keys.push(monthKey(new Date(y, m - 1 - i, 1)));
  const has = (k) => state.transactions.some((t) => t.month === k) || (state.months[k]?.income || []).some((x) => Number(x.actual) > 0);
  const first = keys.findIndex(has);
  if (first < 0) return [];
  return keys.slice(first).map((k) => {
    if (!has(k)) return { key: k, income: 0, expense: 0, savingRatio: null, fixed: 0, empty: true };
    const s = summarizeSilently(k);
    return { key: k, income: s.incomeActual, expense: s.totalActual, savingRatio: s.savingRatio, fixed: s.fixedActual };
  });
}

// summarize tanpa membuat data bulan baru (ensureMonth) untuk bulan yang belum ada
function summarizeSilently(k) {
  if (state.months[k]) return summarize(k);
  const before = state.months[k];
  const s = summarize(k);
  if (!before) delete state.months[k];
  return s;
}

/** Perbandingan aktual per kategori: bulan `key` vs bulan sebelumnya. */
export function compareWithPrevious(key) {
  const [y, m] = key.split('-').map(Number);
  const prevKey = monthKey(new Date(y, m - 2, 1));
  const cur = summarizeSilently(key), prev = summarizeSilently(prevKey);
  return {
    prevKey,
    rows: cur.cats.map((c) => {
      const p = prev.cats.find((x) => x.id === c.id)?.actual || 0;
      const good = !!state.categories.find((x) => x.id === c.id)?.overIsGood;
      return { id: c.id, name: c.name, prev: p, cur: c.actual, delta: c.actual - p, overIsGood: good };
    }).filter((r) => r.prev || r.cur),
  };
}
