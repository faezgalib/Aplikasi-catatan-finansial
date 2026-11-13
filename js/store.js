// Penyimpanan data di localStorage (data hanya ada di perangkat ini).
import { DEFAULT_CATEGORIES, DEFAULT_FIXED_ITEMS } from './defaults.js';

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
    version: 2,
    settings: { apiKey: '', smallNumberThousands: true, aiMode: 'unknown' },
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

// v1 -> v2: fixed cost ditandai per item (bukan per kategori), sesuai rumus Excel.
function migrate() {
  if ((state.version || 1) >= 2) return;
  const ids = new Set(DEFAULT_FIXED_ITEMS);
  for (const c of state.categories || []) {
    if (c.type === 'fixed') c.type = 'variable';
    for (const it of c.items) if (it.fixed === undefined) it.fixed = ids.has(it.id);
  }
  state.version = 2;
  save();
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
