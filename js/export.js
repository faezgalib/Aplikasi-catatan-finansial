// Export ke Excel (.xlsx) memakai SheetJS (vendor/xlsx.mini.min.js), dimuat saat dibutuhkan.
import { getState, summarize } from './store.js';

function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.mini.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Gagal memuat modul Excel.'));
    document.head.appendChild(s);
  });
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

/** Satu sheet per bulan dengan susunan seperti template Excel. */
function monthSheetRows(key) {
  const s = summarize(key);
  const pct = (v) => (v == null ? '' : { t: 'n', v, z: '0.0%' });
  const rows = [
    [`Personal monthly budget - ${monthLabel(key)}`],
    [],
    ['PREVIOUS BALANCE ON SAVING ACCOUNT', '', '', Number(s.month.prevBalance || 0)],
    ['PROJECTED MONTHLY INCOME', '', '', s.incomeProjected],
  ];
  for (const i of s.month.income) rows.push(['', i.name, Number(i.projected || 0), Number(i.actual || 0)]);
  rows.push(
    ['ACTUAL MONTHLY INCOME', '', '', s.incomeActual],
    [],
    ['TOTAL PROJECTED EXPENSE', '', '', s.totalProjected],
    ['TOTAL ACTUAL EXPENSE', '', '', s.totalActual],
    ['TOTAL EXPENSE DIFFERENCE', '', '', s.expenseDiff],
    ['ACTUAL BALANCE THIS MONTH (income - expenses)', '', '', s.balance],
    ['BALANCE DIFFERENCE (actual - projected)', '', '', s.balanceDiff],
    [],
    ['Saving to Income Ratio', '', '', pct(s.savingRatio)],
    ['Fixed Cost (Non Food) to Income', '', '', pct(s.fixedRatio)],
    ['Food and Groceries to Income', '', '', pct(s.foodRatio)],
    [],
  );
  for (const c of s.cats) {
    rows.push([c.name.toUpperCase(), 'Projected cost', 'Actual cost', 'Difference']);
    for (const it of c.items) rows.push([it.name, it.projected, it.actual, it.diff]);
    rows.push(['Total', c.projected, c.actual, c.diff], []);
  }
  return rows;
}

// Format angka ribuan untuk semua sel angka yang belum punya format.
function moneyFormat(XLSX, ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === 'n' && !cell.z) cell.z = '#,##0';
    }
  }
  return ws;
}

export async function exportExcel(keys) {
  const XLSX = await loadXLSX();
  const st = getState();
  const wb = XLSX.utils.book_new();
  const sorted = [...keys].sort();

  // Ringkasan tahunan: bulan x kategori
  const cats = st.categories;
  const recap = [['Bulan', 'Pemasukan', ...cats.map((c) => c.name), 'Total Pengeluaran', 'Saldo', 'Saving Ratio']];
  for (const k of sorted) {
    const s = summarize(k);
    recap.push([
      monthLabel(k), s.incomeActual, ...s.cats.map((c) => c.actual), s.totalActual, s.balance,
      s.savingRatio == null ? '' : { t: 'n', v: s.savingRatio, z: '0.0%' },
    ]);
  }
  const wsRecap = moneyFormat(XLSX, XLSX.utils.aoa_to_sheet(recap));
  wsRecap['!cols'] = recap[0].map((_, i) => ({ wch: i === 0 ? 18 : 16 }));
  XLSX.utils.book_append_sheet(wb, wsRecap, 'Ringkasan');

  for (const k of sorted) {
    const ws = moneyFormat(XLSX, XLSX.utils.aoa_to_sheet(monthSheetRows(k)));
    ws['!cols'] = [{ wch: 46 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, monthLabel(k).slice(0, 31));
  }

  // Semua transaksi
  const tx = [['Bulan', 'Tanggal', 'Kategori', 'Item', 'Keterangan', 'Jumlah (Rp)']];
  const keySet = new Set(sorted);
  for (const t of st.transactions.filter((x) => keySet.has(x.month)).sort((a, b) => (a.month + (a.date || '')).localeCompare(b.month + (b.date || '')))) {
    const c = cats.find((x) => x.id === t.catId);
    const it = c?.items.find((x) => x.id === t.itemId);
    tx.push([monthLabel(t.month), t.date || '', c?.name || '?', it?.name || '?', t.desc, t.amount]);
  }
  const wsTx = moneyFormat(XLSX, XLSX.utils.aoa_to_sheet(tx));
  wsTx['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 22 }, { wch: 32 }, { wch: 36 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsTx, 'Transaksi');

  const name = sorted.length === 1 ? `Budget ${monthLabel(sorted[0])}.xlsx` : `Budget ${monthLabel(sorted[0])} - ${monthLabel(sorted[sorted.length - 1])}.xlsx`;
  XLSX.writeFile(wb, name);
}
