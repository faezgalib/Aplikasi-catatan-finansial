import { parseNotes, categorize, normalizeText, formatRp } from './parser.js';
import * as store from './store.js';
import { CATEGORY_TYPES } from './defaults.js';
import { exportExcel, monthLabel } from './export.js';
import { categorizeWithAI } from './ai.js';
import * as lock from './lock.js';
import { APP_VERSION, CHANGELOG } from './version.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(1).replace('.', ',')}%`);
const parseAmount = (v) => Number(String(v).replace(/[^\d-]/g, '')) || 0;
const fmtInput = (n) => (n ? Number(n).toLocaleString('id-ID') : '');

// ---------- titik ribuan otomatis untuk semua kolom nominal (inputmode="numeric") ----------
const groupDigits = (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function liveFormat(inp) {
  const pos = inp.selectionStart ?? inp.value.length;
  const digitsBefore = inp.value.slice(0, pos).replace(/\D/g, '').length;
  const digits = inp.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const out = groupDigits(digits);
  if (out === inp.value) return;
  inp.value = out;
  // kembalikan kursor ke posisi setelah digit yang sama
  let caret = 0, seen = 0;
  while (caret < out.length && seen < digitsBefore) { if (/\d/.test(out[caret])) seen++; caret++; }
  try { inp.setSelectionRange(caret, caret); } catch {}
}
const isAmount = (el) => el instanceof HTMLInputElement && el.inputMode === 'numeric';
document.addEventListener('beforeinput', (e) => {
  const inp = e.target;
  if (!isAmount(inp) || e.inputType !== 'deleteContentBackward') return;
  const p = inp.selectionStart;
  // Hapus mundur tepat setelah titik: hapus angka sebelum titik, bukan titiknya.
  if (p === inp.selectionEnd && p > 1 && inp.value[p - 1] === '.') {
    e.preventDefault();
    inp.value = inp.value.slice(0, p - 2) + inp.value.slice(p - 1);
    inp.setSelectionRange(p - 2, p - 2);
    liveFormat(inp);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, true);
document.addEventListener('input', (e) => { if (isAmount(e.target)) liveFormat(e.target); }, true);

// ---------- backup ----------
function backupFile() {
  const st = store.getState();
  const copy = { ...st, settings: { ...st.settings, apiKey: '' } }; // jangan ikutkan API key
  const name = `catatan-finansial-backup-${new Date().toISOString().slice(0, 10)}.txt`;
  // .txt karena Chrome Android tidak mengizinkan file .json dibagikan; isinya tetap JSON.
  return new File([JSON.stringify(copy, null, 1)], name, { type: 'text/plain' });
}
function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadBackup() {
  downloadFile(backupFile());
  store.markBackup();
  toast('Backup tersimpan di folder Download.');
}
async function shareBackup() {
  const file = backupFile();
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Backup Catatan Finansial' });
      store.markBackup();
      toast('Backup dibagikan.');
      render();
    } catch (e) {
      if (e.name !== 'AbortError') toast('Gagal membagikan: ' + e.message);
    }
    return;
  }
  toast('Perangkat ini tidak mendukung share. Backup diunduh.');
  downloadBackup();
  render();
}
function needsBackup() {
  const age = backupAgeDays();
  return store.getState().transactions.length > 0 && (age === null || age > 7);
}
function backupAgeDays() {
  const t = store.getState().settings.lastBackupAt;
  return t ? Math.floor((Date.now() - new Date(t).getTime()) / 86400000) : null;
}

const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

const ui = {
  view: 'dashboard',
  month: store.monthKey(),
  review: null, // { rows: [...] }
  expanded: new Set(),
  txFilter: { cat: '', q: '' },
};

store.load();

// ---------- util ----------
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function catColorMap(summary) {
  // Maksimal 8 warna. Tujuh kategori dengan pengeluaran terbesar bulan ini diberi warna
  // (urutan warna mengikuti urutan daftar kategori, bukan peringkat), sisanya abu-abu "Lainnya".
  const cats = store.getState().categories;
  const s = summary || store.summarize(ui.month);
  const top = new Set(s.cats.filter((c) => c.actual > 0).sort((a, b) => b.actual - a.actual).slice(0, 7).map((c) => c.id));
  const map = {};
  let slot = 0;
  for (const c of cats) map[c.id] = top.has(c.id) ? `var(${SERIES[slot++]})` : 'var(--s-other)';
  return map;
}

function catOptions(selected, { blank = false } = {}) {
  const cats = store.getState().categories;
  return (blank ? '<option value="">— pilih kategori —</option>' : '') +
    cats.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
function itemOptions(catId, selected) {
  const c = store.getState().categories.find((x) => x.id === catId);
  if (!c) return '<option value="">—</option>';
  return c.items.map((i) => `<option value="${i.id}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
}

function learn(desc, catId, itemId) {
  const key = normalizeText(desc);
  if (!key || !catId || !itemId) return;
  store.getState().learned[key] = { catId, itemId };
}

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return store.monthKey(new Date(y, m - 1 + delta, 1));
}

function defaultDateForMonth() {
  const today = new Date();
  if (store.monthKey(today) === ui.month) return today.toISOString().slice(0, 10);
  return '';
}

// ---------- navigation ----------
function setView(v) {
  ui.view = v;
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${v}`));
  $$('.bottomnav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  try { localStorage.setItem('catfin.view', v); } catch {}
  render();
  window.scrollTo({ top: 0 });
}

function setMonth(key) {
  ui.month = key;
  store.ensureMonth(key);
  render();
}

function renderHeader() {
  document.querySelector('.bottomnav [data-view="settings"]').classList.toggle('dot', needsBackup());
  $('#monthLabel').textContent = monthLabel(ui.month);
  $('#monthPicker').value = ui.month;
}

function render() {
  renderHeader();
  ({ dashboard: renderDashboard, input: renderInput, tx: renderTx, budget: renderBudget, settings: renderSettings })[ui.view]();
}

// ---------- dashboard ----------
function donutSVG(slices, total) {
  const R = 100, r = 64, cx = 120, cy = 120, gap = 0.012;
  if (!total) return `<svg viewBox="0 0 240 240" role="img" aria-label="Belum ada data"><circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="var(--surface-2)" stroke-width="${R - r}"/></svg>`;
  let a0 = -Math.PI / 2;
  const paths = slices.map((s) => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const g = slices.length > 1 ? Math.min(gap, frac * Math.PI) : 0;
    const s0 = a0 + g / 2, s1 = a1 - g / 2;
    a0 = a1;
    if (slices.length === 1) {
      return `<path data-id="${s.id}" fill="${s.color}" fill-rule="evenodd" d="M${cx + R},${cy}A${R},${R} 0 1,1 ${cx - R},${cy}A${R},${R} 0 1,1 ${cx + R},${cy}ZM${cx + r},${cy}A${r},${r} 0 1,0 ${cx - r},${cy}A${r},${r} 0 1,0 ${cx + r},${cy}Z"/>`;
    }
    const large = s1 - s0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
    return `<path data-id="${s.id}" fill="${s.color}" d="M${p(R, s0)}A${R},${R} 0 ${large},1 ${p(R, s1)}L${p(r, s1)}A${r},${r} 0 ${large},0 ${p(r, s0)}Z"><title>${esc(s.name)}: ${formatRp(s.value)} (${pct(frac)})</title></path>`;
  });
  return `<svg viewBox="0 0 240 240" role="img" aria-label="Komposisi pengeluaran per kategori">${paths.join('')}</svg>`;
}

// ---------- tren antar bulan ----------
const shortMonth = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'short' }); };
const juta = (v) => `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`;
function niceMax(v) {
  if (v <= 0) return 1e6;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((f) => f * p).find((x) => x >= v);
}

function trendHTML() {
  const data = store.trend(ui.month, 12);
  if (data.length < 2) {
    return `<div class="card"><h3>Tren antar bulan</h3><p class="hint">Grafik tren muncul setelah ada data minimal 2 bulan.</p></div>`;
  }
  // Grafik 1: pemasukan vs pengeluaran (batang berdampingan, satu sumbu Rupiah)
  const W = 360, H = 170, L = 34, B = 140, T = 14;
  const max = niceMax(Math.max(...data.flatMap((d) => [d.income, d.expense])));
  const slot = (W - L - 4) / data.length;
  const bw = Math.min(12, (slot - 6) / 2);
  const yv = (v) => B - (v / max) * (B - T);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" y1="${yv(max * f)}" x2="${W}" y2="${yv(max * f)}" class="grid"/><text x="${L - 4}" y="${yv(max * f) + 3}" class="ax" text-anchor="end">${f ? juta(max * f) : '0'}</text>`).join('');
  const bars = data.map((d, i) => {
    const x = L + i * slot + (slot - 2 * bw - 2) / 2;
    const r = (v, xx, cls) => v > 0 ? `<rect x="${xx}" y="${yv(v)}" width="${bw}" height="${B - yv(v)}" rx="2" class="${cls}"/>` : '';
    return `<g class="tbar ${d.key === ui.month ? 'cur' : ''}" data-i="${i}">
      <rect x="${L + i * slot}" y="${T}" width="${slot}" height="${B - T + 16}" class="hit"/>
      ${r(d.income, x, 'b-inc')}${r(d.expense, x + bw + 2, 'b-exp')}
      <text x="${L + i * slot + slot / 2}" y="${B + 12}" class="ax" text-anchor="middle">${shortMonth(d.key)}</text></g>`;
  }).join('');

  // Grafik 2: saving ratio (garis, sumbu persen sendiri)
  const H2 = 120, B2 = 96, T2 = 12;
  const rmax = Math.max(0.5, ...data.map((d) => d.savingRatio || 0));
  const ry = (v) => B2 - (v / rmax) * (B2 - T2);
  const pts = data.map((d, i) => d.savingRatio == null ? null : [L + i * slot + slot / 2, ry(d.savingRatio), d]).filter(Boolean);
  const grid2 = [0, 0.5, 1].map((f) => `<line x1="${L}" y1="${ry(rmax * f)}" x2="${W}" y2="${ry(rmax * f)}" class="grid"/><text x="${L - 4}" y="${ry(rmax * f) + 3}" class="ax" text-anchor="end">${Math.round(rmax * f * 100)}%</text>`).join('');
  const last = pts[pts.length - 1];
  const line = pts.length ? `<polyline points="${pts.map((p) => p.slice(0, 2).join(',')).join(' ')}" class="l-sav"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2].key === ui.month ? 4.5 : 3}" class="d-sav"><title>${shortMonth(p[2].key)}: ${pct(p[2].savingRatio)}</title></circle>`).join('')}${last ? `<text x="${last[0]}" y="${last[1] - 8}" class="lbl" text-anchor="end">${pct(last[2].savingRatio)}</text>` : ''}` : '';

  const cmp = store.compareWithPrevious(ui.month);
  const cmpRows = cmp.rows.map((r) => {
    if (!r.delta) return `<tr><td>${esc(r.name)}</td><td class="num hide-sm">${formatRp(r.prev)}</td><td class="num">${formatRp(r.cur)}</td><td class="num">–</td></tr>`;
    const up = r.delta > 0;
    const good = r.overIsGood ? up : !up;
    return `<tr><td>${esc(r.name)}</td><td class="num hide-sm">${formatRp(r.prev)}</td><td class="num">${formatRp(r.cur)}</td><td class="num ${good ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${formatRp(Math.abs(r.delta))}</td></tr>`;
  }).join('');

  return `
    <div class="card">
      <h3>Tren · pemasukan vs pengeluaran</h3>
      <div class="legend-row"><span><i class="sw b-inc"></i>Pemasukan</span><span><i class="sw b-exp"></i>Pengeluaran</span></div>
      <svg class="tchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pemasukan dan pengeluaran per bulan">${grid}${bars}</svg>
      <p class="tinfo" id="tinfo">Ketuk batang untuk melihat angkanya.</p>
      <table class="cat-table sr-table"><thead><tr><th>Bulan</th><th>Pemasukan</th><th>Pengeluaran</th><th>Saving</th></tr></thead><tbody>
        ${data.map((d) => `<tr><td>${esc(monthLabel(d.key))}</td><td class="num">${formatRp(d.income)}</td><td class="num">${formatRp(d.expense)}</td><td class="num">${pct(d.savingRatio)}</td></tr>`).join('')}
      </tbody></table>
      <button class="btn ghost small" id="toggleTrendTable">Lihat sebagai tabel</button>
    </div>
    <div class="card">
      <h3>Tren · saving to income</h3>
      <svg class="tchart" viewBox="0 0 ${W} ${H2}" role="img" aria-label="Saving ratio per bulan">${grid2}${line}</svg>
    </div>
    <div class="card">
      <h3>Dibanding ${esc(monthLabel(cmp.prevKey))}</h3>
      ${cmpRows ? `<table class="cat-table"><thead><tr><th>Kategori</th><th class="hide-sm">${esc(shortMonth(cmp.prevKey))}</th><th>${esc(shortMonth(ui.month))}</th><th>Perubahan</th></tr></thead><tbody>${cmpRows}</tbody></table>` : '<p class="hint">Belum ada data untuk dibandingkan.</p>'}
      <p class="hint">Pengeluaran naik = merah, turun = hijau. Untuk kategori "melebihi = baik" (Savings, Donasi) kebalikannya.</p>
    </div>`;
}

function bindTrend(el) {
  const data = store.trend(ui.month, 12);
  const info = $('#tinfo', el);
  $$('.tbar', el).forEach((g) => {
    const show = () => {
      const d = data[+g.dataset.i];
      $$('.tbar', el).forEach((x) => x.classList.toggle('on', x === g));
      info.innerHTML = `<b>${esc(monthLabel(d.key))}</b> · Pemasukan <b class="num">${formatRp(d.income)}</b> · Pengeluaran <b class="num">${formatRp(d.expense)}</b> · Saldo <b class="num ${d.income - d.expense < 0 ? 'neg' : 'pos'}">${formatRp(d.income - d.expense)}</b>`;
    };
    g.addEventListener('mouseenter', show);
    g.addEventListener('click', show);
  });
  const tg = $('#toggleTrendTable', el);
  if (tg) tg.onclick = () => { const t = $('.sr-table', el); t.classList.toggle('show'); tg.textContent = t.classList.contains('show') ? 'Sembunyikan tabel' : 'Lihat sebagai tabel'; };
}

function renderDashboard() {
  const s = store.summarize(ui.month);
  const colors = catColorMap(s);
  const el = $('#view-dashboard');

  const withSpend = s.cats.filter((c) => c.actual > 0).sort((a, b) => b.actual - a.actual);
  const total = withSpend.reduce((a, c) => a + c.actual, 0);
  // Maksimal 8 warna; kategori ke-9 dst digabung menjadi "Lainnya".
  let slices = withSpend.map((c) => ({ id: c.id, name: c.name, value: c.actual, color: colors[c.id] }));
  const overflow = slices.filter((x) => x.color === 'var(--s-other)');
  if (overflow.length > 1) {
    slices = slices.filter((x) => x.color !== 'var(--s-other)');
    slices.push({ id: '_other', name: 'Lainnya', value: overflow.reduce((a, x) => a + x.value, 0), color: 'var(--s-other)' });
  }

  const kpi = (label, value, sub = '', cls = '') => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value num">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  const status = store.budgetStatus(s);
  const lv = {
    bad: (x) => ['bad', '!', `${formatRp(x.actual)} dari ${formatRp(x.projected)}`, 'neg', `${Math.round(x.ratio * 100)}%`],
    warn: (x) => ['warn', '!', `${formatRp(x.actual)} dari ${formatRp(x.projected)}`, 'warn', `${Math.round(x.ratio * 100)}%`],
    good: (x) => ['good', '✓', 'Melebihi target, bagus', 'pos', `${Math.round(x.ratio * 100)}%`],
    nobudget: (x) => ['muted', '–', `${formatRp(x.actual)}, tanpa budget`, 'grey', '–'],
  };

  el.innerHTML = `
    <div class="kpis">
      ${kpi('Pemasukan aktual', formatRp(s.incomeActual), `Proyeksi ${formatRp(s.incomeProjected)}`)}
      ${kpi('Total pengeluaran', formatRp(s.totalActual), `Proyeksi ${formatRp(s.totalProjected)}`)}
      ${kpi('Saldo bulan ini', formatRp(s.balance), 'Pemasukan − pengeluaran', s.balance < 0 ? 'bad' : 'good')}
      ${kpi('Selisih pengeluaran', formatRp(s.expenseDiff), 'Proyeksi − aktual', s.expenseDiff < 0 ? 'bad' : 'good')}
      ${kpi('Saving to income', pct(s.savingRatio), formatRp(s.savingActual))}
      ${kpi('Fixed cost (non food)', formatRp(s.fixedActual), `${pct(s.fixedRatio)} dari pemasukan`)}
      ${kpi('Food & groceries', formatRp(s.foodActual), `${pct(s.foodRatio)} dari pemasukan`)}
      ${kpi('Saldo tabungan awal', formatRp(s.month.prevBalance || 0), 'Isi di menu Budget')}
    </div>

    <div class="card">
      <h3>Total pengeluaran per kategori</h3>
      ${total ? '' : '<p class="hint">Belum ada transaksi bulan ini. Mulai dari menu <b>Input Notes</b>.</p>'}
      <div class="chart-wrap">
        <div class="donut" id="donut">
          ${donutSVG(slices, total)}
          <div class="donut-center"><span class="big num" id="dcBig">${formatRp(total)}</span><span class="small" id="dcSmall">Total aktual</span></div>
        </div>
        <ul class="legend" id="legend">
          ${slices.map((x) => `<li data-id="${x.id}"><span class="sw" style="background:${x.color}"></span><span>${esc(x.name)}</span><span class="num">${formatRp(x.value)}</span><span class="pct num">${pct(x.value / total)}</span></li>`).join('')}
        </ul>
      </div>
    </div>

    <div class="card">
      <h3>Proyeksi vs aktual</h3>
      <table class="cat-table">
        <thead><tr><th>Kategori</th><th class="hide-sm">Proyeksi</th><th>Aktual</th><th>Selisih</th></tr></thead>
        <tbody>
          ${s.cats.map((c) => `
            <tr class="cat-row" data-cat="${c.id}">
              <td><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:${colors[c.id]}"></span>${ui.expanded.has(c.id) ? '▾' : '▸'} ${esc(c.name)}</td>
              <td class="num hide-sm">${formatRp(c.projected)}</td>
              <td class="num">${formatRp(c.actual)}</td>
              <td class="num"><span class="pill ${c.diff < 0 && !store.getState().categories.find((x) => x.id === c.id)?.overIsGood ? 'neg' : 'pos'}">${formatRp(c.diff)}</span></td>
            </tr>
            ${ui.expanded.has(c.id) ? c.items.filter((i) => i.projected || i.actual).map((i) => `
              <tr class="item-row"><td>${esc(i.name)}</td><td class="num hide-sm">${formatRp(i.projected)}</td><td class="num">${formatRp(i.actual)}</td><td class="num ${i.diff < 0 ? 'neg' : ''}">${formatRp(i.diff)}</td></tr>`).join('') || '<tr class="item-row"><td colspan="4">Belum ada data</td></tr>' : ''}
          `).join('')}
          <tr class="cat-row"><td>Total</td><td class="num hide-sm">${formatRp(s.totalProjected)}</td><td class="num">${formatRp(s.totalActual)}</td><td class="num"><span class="pill ${s.expenseDiff < 0 ? 'neg' : 'pos'}">${formatRp(s.expenseDiff)}</span></td></tr>
        </tbody>
      </table>
    </div>
    ${trendHTML()}

    <div class="card">
      <h3>Status budget</h3>
      ${status.length ? `<ul class="status-list">${status.map((x) => {
        const [ico, sym, sub, pill, val] = lv[x.level](x);
        return `<li><span class="st-ico ${ico}">${sym}</span><span><b>${esc(x.name)}</b><br><small>${sub}</small></span><span class="pill ${pill} num">${val}</span></li>`;
      }).join('')}</ul>` : '<p class="hint">Semua kategori masih di bawah 80% dari proyeksi.</p>'}
      <p class="hint">Kuning ≥ 80%, merah ≥ 100% dari proyeksi. Kategori bertanda "melebihi = baik" (Savings, Donasi) tampil hijau.</p>
    </div>`;

  bindTrend(el);

  // hover / tap pada donut & legend
  const donut = $('#donut', el);
  const highlight = (id) => {
    donut.classList.toggle('hovering', !!id);
    $$('path', donut).forEach((p) => p.classList.toggle('on', p.dataset.id === id));
    $$('#legend li', el).forEach((li) => li.classList.toggle('on', li.dataset.id === id));
    const sl = slices.find((x) => x.id === id);
    $('#dcBig', el).textContent = sl ? formatRp(sl.value) : formatRp(total);
    $('#dcSmall', el).textContent = sl ? `${sl.name} · ${pct(sl.value / total)}` : 'Total aktual';
  };
  $$('path', donut).forEach((p) => {
    p.addEventListener('mouseenter', () => highlight(p.dataset.id));
    p.addEventListener('click', () => highlight(p.dataset.id));
  });
  donut.addEventListener('mouseleave', () => highlight(null));
  $$('#legend li', el).forEach((li) => {
    li.addEventListener('mouseenter', () => highlight(li.dataset.id));
    li.addEventListener('mouseleave', () => highlight(null));
    li.addEventListener('click', () => highlight(li.dataset.id));
  });
  $$('tr[data-cat]', el).forEach((tr) => tr.addEventListener('click', () => {
    const id = tr.dataset.cat;
    ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id);
    renderDashboard();
  }));
}

// ---------- input notes ----------
function buildReview(text) {
  const st = store.getState();
  const [y] = ui.month.split('-').map(Number);
  const { entries, skipped } = parseNotes(text, {
    refYear: y,
    smallNumberThousands: st.settings.smallNumberThousands,
  });
  const rows = entries.map((e) => {
    if (e.isIncome) return { ...e, include: true, source: 'income' };
    const c = categorize(e.desc, st.categories, st.learned);
    return { ...e, include: true, catId: c.catId, itemId: c.itemId, source: c.source, touched: false };
  });
  ui.review = { rows, skipped };
}

function renderInput() {
  const el = $('#view-input');
  const st = store.getState();
  const draft = (() => { try { return localStorage.getItem('catfin.draft') || ''; } catch { return ''; } })();

  if (!ui.review) {
    el.innerHTML = `
      <h2>Input dari Notes</h2>
      <p class="hint">Tempel catatan Anda, satu item per baris. Contoh: <code>Kopi 35000</code>, <code>Bensin 150rb</code>, <code>Listrik 503.000</code>.
      Tanggal opsional di awal baris (<code>12/11 sate 45k</code>) atau sebagai judul (<code>12 Nov</code>). Baris diawali <code>+</code> dicatat sebagai pemasukan.
      Semua masuk ke bulan <b>${esc(monthLabel(ui.month))}</b>.</p>
      <div class="quick-row">
        <button class="quick" id="recurBtn"><span class="quick-ico">↻</span><b>Isi transaksi rutin</b><small>${esc(st.categories.flatMap((c) => c.items.filter((i) => i.recurring).map((i) => i.name)).join(', ') || 'Belum ada item rutin. Centang "Rutin" di menu Budget.')}</small></button>
      </div>
      <div class="card">
        <label>Catatan
          <textarea id="notesText" placeholder="Kopi 35000&#10;Bensin 150rb&#10;Listrik 503.000&#10;Sedekah jumat 100rb">${esc(draft)}</textarea>
        </label>
        <div class="btn-row">
          <button class="btn" id="pasteBtn">Tempel dari clipboard</button>
          <button class="btn ghost" id="clearBtn">Kosongkan</button>
          <span class="spacer"></span>
          <button class="btn primary" id="parseBtn">Proses catatan →</button>
        </div>
      </div>
      <div class="card">
        <h3>Tambah satu transaksi</h3>
        <p class="hint">Untuk input cepat tanpa notes.</p>
        <button class="btn" id="manualBtn">+ Tambah manual</button>
      </div>`;
    const ta = $('#notesText', el);
    ta.addEventListener('input', () => { try { localStorage.setItem('catfin.draft', ta.value); } catch {} });
    $('#pasteBtn', el).onclick = async () => {
      try {
        const t = await navigator.clipboard.readText();
        ta.value = (ta.value ? ta.value + '\n' : '') + t;
        ta.dispatchEvent(new Event('input'));
      } catch {
        toast('Clipboard tidak bisa dibaca. Tekan lama di kotak teks lalu pilih Tempel.');
      }
    };
    $('#clearBtn', el).onclick = () => { ta.value = ''; ta.dispatchEvent(new Event('input')); };
    $('#parseBtn', el).onclick = () => {
      if (!ta.value.trim()) return toast('Catatan masih kosong.');
      buildReview(ta.value);
      if (!ui.review.rows.length) { ui.review = null; return toast('Tidak ada baris dengan angka yang bisa dibaca.'); }
      renderInput();
      maybeAutoAI();
    };
    $('#manualBtn', el).onclick = () => openTxDialog(null);
    $('#recurBtn', el).onclick = startRecurring;
    return;
  }

  const rows = ui.review.rows;
  const unknown = rows.filter((r) => r.include && !r.isIncome && !r.catId).length;
  const included = rows.filter((r) => r.include);
  const sumExp = included.filter((r) => !r.isIncome).reduce((a, r) => a + r.amount, 0);
  const sumInc = included.filter((r) => r.isIncome).reduce((a, r) => a + r.amount, 0);
  const month = store.ensureMonth(ui.month);
  const badge = (r) => r.isIncome ? '<span class="badge income">Pemasukan</span>'
    : r.source === 'learned' ? '<span class="badge learned">Dari riwayat</span>'
    : r.source === 'keyword' ? '<span class="badge">Kata kunci</span>'
    : r.source === 'ai' ? '<span class="badge ai">AI</span>'
    : r.source === 'manual' ? '<span class="badge">Dipilih manual</span>'
    : r.source === 'rutin' ? '<span class="badge rutin">Rutin</span>'
    : '<span class="badge none">Belum dikenali</span>';

  el.innerHTML = `
    ${ui.review.kind === 'rutin'
      ? `<h2>Transaksi rutin ${esc(monthLabel(ui.month))} (${rows.length})</h2><p class="hint">Nominal diambil dari aktual bulan lalu (atau proyeksi bila belum ada). Ubah bila berbeda, lalu simpan.</p>`
      : `<h2>Periksa hasil (${rows.length} baris)</h2><p class="hint">Periksa kategori, ubah bila perlu, lalu simpan. Kategori yang Anda ubah akan diingat untuk catatan berikutnya.</p>`}
    ${ui.review.skipped.length ? `<div class="card"><b>Dilewati (tidak ada angka):</b><br><small>${ui.review.skipped.map(esc).join(' · ')}</small></div>` : ''}
    <div class="review">
      ${rows.map((r, i) => `
        <div class="rv ${!r.include ? 'off' : ''} ${r.include && !r.isIncome && !r.catId ? 'unknown' : ''}" data-i="${i}">
          <input type="checkbox" class="inc" ${r.include ? 'checked' : ''} aria-label="Sertakan">
          <input class="desc" value="${esc(r.desc)}" aria-label="Keterangan">
          <input class="amt num" inputmode="numeric" value="${fmtInput(r.amount)}" aria-label="Jumlah">
          <div class="sel">
            ${r.isIncome
              ? `<select class="income-line">${month.income.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}<option value="_new">+ Baris pemasukan baru</option></select><span></span>`
              : `<select class="cat">${catOptions(r.catId, { blank: true })}</select><select class="item">${itemOptions(r.catId, r.itemId)}</select>`}
          </div>
          <div class="meta">${badge(r)}${r.date ? `<span>${esc(r.date)}</span>` : ''}${r.assumedThousands ? '<span class="badge none">dianggap ribuan</span>' : ''}${r.raw ? `<span>“${esc(r.raw)}”</span>` : ''}</div>
        </div>`).join('')}
    </div>
    <div class="summary-bar">
      <span>Pengeluaran <b class="num">${formatRp(sumExp)}</b>${sumInc ? ` · Pemasukan <b class="num">${formatRp(sumInc)}</b>` : ''}</span>
      <span class="spacer"></span>
      <button class="btn ghost" id="backBtn">${ui.review.kind === 'rutin' ? 'Batal' : '← Ubah notes'}</button>
      ${unknown ? `<button class="btn" id="aiBtn">Tanya AI (${unknown})</button>` : ''}
      <button class="btn primary" id="saveBtn" ${unknown ? 'disabled' : ''}>Simpan ${included.length}</button>
    </div>
    ${unknown ? `<p class="hint">${unknown} item belum punya kategori. Pilih manual${st.settings.apiKey ? ' atau tekan <b>Tanya AI</b>' : ', atau isi API key Claude di Pengaturan agar bisa ditanyakan ke AI'}.</p>` : ''}`;

  $$('.rv', el).forEach((card) => {
    const r = rows[+card.dataset.i];
    $('.inc', card).onchange = (e) => { r.include = e.target.checked; renderInput(); };
    $('.desc', card).onchange = (e) => { r.desc = e.target.value.trim(); };
    $('.amt', card).onchange = (e) => { r.amount = parseAmount(e.target.value); renderInput(); };
    const cat = $('.cat', card);
    if (cat) {
      cat.onchange = () => {
        const c = st.categories.find((x) => x.id === cat.value);
        r.catId = cat.value || null;
        r.itemId = c ? (c.items.find((i) => /lainnya/i.test(i.name)) || c.items[0]).id : null;
        r.touched = true; r.source = 'manual';
        renderInput();
      };
      $('.item', card).onchange = (e) => { r.itemId = e.target.value; r.touched = true; r.source = 'manual'; renderInput(); };
    }
    const inc = $('.income-line', card);
    if (inc) { r.incomeId ||= inc.value; inc.value = r.incomeId; inc.onchange = () => { r.incomeId = inc.value; }; }
  });
  $('#backBtn', el).onclick = () => { ui.review = null; renderInput(); };
  const ai = $('#aiBtn', el);
  if (ai) ai.onclick = () => runAI(ai);
  $('#saveBtn', el).onclick = saveReview;
}

async function runAI(btn) {
  const st = store.getState();
  if (!st.settings.apiKey) { toast('Isi API key Claude dulu di menu Pengaturan.'); return; }
  const rows = ui.review.rows;
  const targets = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include && !r.isIncome && !r.catId);
  if (!targets.length) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Menanyakan AI…'; }
  try {
    const res = await categorizeWithAI(targets.map(({ r }) => r), st.categories, st.settings.apiKey);
    for (const x of res) {
      const t = targets[x.index];
      if (t) Object.assign(t.r, { catId: x.catId, itemId: x.itemId, source: 'ai' });
    }
    toast(`AI mengkategorikan ${res.length} dari ${targets.length} item. Silakan periksa.`);
  } catch (e) {
    toast(`AI gagal: ${e.message || e}`, 5000);
  }
  if (ui.view === 'input' && ui.review) renderInput();
}

function maybeAutoAI() {
  const st = store.getState();
  if (st.settings.apiKey && st.settings.aiMode === 'auto' && ui.review.rows.some((r) => !r.isIncome && !r.catId)) runAI($('#aiBtn'));
}

function startRecurring() {
  const month = store.ensureMonth(ui.month);
  const rows = store.recurringEntries(ui.month);
  if (!rows.length) return toast('Belum ada item rutin. Centang "Rutin" pada item di menu Budget.');
  if (month.recurringFilledAt) {
    const d = new Date(month.recurringFilledAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    if (!confirm(`Transaksi rutin ${monthLabel(ui.month)} sudah diisi tanggal ${d}. Tetap tambahkan lagi?`)) return;
  }
  ui.review = {
    kind: 'rutin',
    skipped: [],
    rows: rows.map((r) => ({ ...r, include: r.amount > 0, date: '', raw: '', source: 'rutin', touched: false })),
  };
  renderInput();
}

function saveReview() {
  const st = store.getState();
  const month = store.ensureMonth(ui.month);
  let nTx = 0, nInc = 0;
  for (const r of ui.review.rows) {
    if (!r.include || !r.amount) continue;
    if (r.isIncome) {
      let line = month.income.find((x) => x.id === r.incomeId);
      if (!line) { line = { id: store.uid(), name: r.desc || 'Extra income', projected: 0, actual: 0 }; month.income.push(line); }
      line.actual = Number(line.actual || 0) + r.amount;
      nInc++;
      continue;
    }
    st.transactions.push({
      id: store.uid(), month: ui.month, date: r.date || '', desc: r.desc, amount: r.amount,
      catId: r.catId, itemId: r.itemId, source: r.source, createdAt: Date.now(),
    });
    // Simpan ke "ingatan" bila dikoreksi manual atau ditentukan AI, supaya lain kali tidak perlu AI.
    if (r.touched || r.source === 'ai') learn(r.desc, r.catId, r.itemId);
    nTx++;
  }
  if (ui.review.kind === 'rutin' && nTx) month.recurringFilledAt = new Date().toISOString();
  store.save();
  const wasNotes = ui.review.kind !== 'rutin';
  ui.review = null;
  if (wasNotes) { try { localStorage.removeItem('catfin.draft'); } catch {} }
  toast(`Tersimpan: ${nTx} transaksi${nInc ? `, ${nInc} pemasukan` : ''}.`);
  setView('dashboard');
}

// ---------- transaksi ----------
function renderTx() {
  const el = $('#view-tx');
  const st = store.getState();
  const colors = catColorMap();
  const q = normalizeText(ui.txFilter.q);
  const list = st.transactions
    .filter((t) => t.month === ui.month)
    .filter((t) => !ui.txFilter.cat || t.catId === ui.txFilter.cat)
    .filter((t) => !q || normalizeText(t.desc).includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const total = list.reduce((a, t) => a + t.amount, 0);

  const groups = new Map();
  for (const t of list) {
    const k = t.date || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const dateLabel = (d) => d ? new Date(d + 'T00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' }) : 'Tanpa tanggal';

  el.innerHTML = `
    <h2>Transaksi ${esc(monthLabel(ui.month))}</h2>
    <div class="filters">
      <select id="fCat"><option value="">Semua kategori</option>${catOptions(ui.txFilter.cat)}</select>
      <input id="fQ" placeholder="Cari…" value="${esc(ui.txFilter.q)}">
    </div>
    <div class="btn-row"><span>${list.length} transaksi · <b class="num">${formatRp(total)}</b></span><span class="spacer"></span><button class="btn primary" id="addTx">+ Tambah</button></div>
    ${list.length ? [...groups].map(([d, items]) => `
      <div class="tx-group"><h4>${esc(dateLabel(d))}</h4>
        ${items.map((t) => {
          const { cat, item } = store.findItem(t.catId, t.itemId);
          return `<button class="tx" data-id="${t.id}"><span class="dot" style="background:${colors[t.catId] || 'var(--s-other)'}"></span><span class="d"><b>${esc(t.desc)}</b><small>${esc(cat?.name || '?')} · ${esc(item?.name || '?')}</small></span><span class="num">${formatRp(t.amount)}</span></button>`;
        }).join('')}
      </div>`).join('') : '<div class="empty">Belum ada transaksi.</div>'}`;

  $('#fCat', el).onchange = (e) => { ui.txFilter.cat = e.target.value; renderTx(); };
  const fq = $('#fQ', el);
  fq.oninput = () => { ui.txFilter.q = fq.value; clearTimeout(renderTx._t); renderTx._t = setTimeout(() => { renderTx(); const n = $('#fQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $('#addTx', el).onclick = () => openTxDialog(null);
  $$('.tx', el).forEach((b) => (b.onclick = () => openTxDialog(st.transactions.find((t) => t.id === b.dataset.id))));
}

function openTxDialog(tx) {
  const dlg = $('#txDialog');
  const f = $('#txForm');
  const st = store.getState();
  $('#txDialogTitle').textContent = tx ? 'Ubah transaksi' : 'Tambah transaksi';
  f.desc.value = tx?.desc || '';
  f.amount.value = fmtInput(tx?.amount || '');
  f.date.value = tx?.date || defaultDateForMonth();
  const catId = tx?.catId || st.categories[0].id;
  f.catId.innerHTML = catOptions(catId);
  f.itemId.innerHTML = itemOptions(catId, tx?.itemId);
  f.learn.checked = true;
  $('#txDelete').style.display = tx ? '' : 'none';

  f.catId.onchange = () => { f.itemId.innerHTML = itemOptions(f.catId.value); };
  f.desc.oninput = () => {
    if (tx) return;
    const c = categorize(f.desc.value, st.categories, st.learned);
    if (c.catId) { f.catId.value = c.catId; f.itemId.innerHTML = itemOptions(c.catId, c.itemId); }
  };
  $('#txCancel').onclick = () => dlg.close();
  $('#txDelete').onclick = () => {
    if (!confirm('Hapus transaksi ini?')) return;
    st.transactions = st.transactions.filter((t) => t.id !== tx.id);
    store.save(); dlg.close(); toast('Transaksi dihapus.'); render();
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    const amount = parseAmount(f.amount.value);
    if (!f.desc.value.trim() || !amount) return toast('Isi keterangan dan jumlah.');
    const data = { desc: f.desc.value.trim(), amount, date: f.date.value, catId: f.catId.value, itemId: f.itemId.value };
    if (data.date) data.month = data.date.slice(0, 7);
    if (tx) Object.assign(tx, data);
    else st.transactions.push({ id: store.uid(), month: data.month || ui.month, source: 'manual', createdAt: Date.now(), ...data });
    if (f.learn.checked) learn(data.desc, data.catId, data.itemId);
    if (data.month) store.ensureMonth(data.month);
    store.save(); dlg.close(); toast('Tersimpan.'); render();
  };
  dlg.showModal();
}

// ---------- budget ----------
function renderBudget() {
  const el = $('#view-budget');
  const st = store.getState();
  const m = store.ensureMonth(ui.month);
  const totalBudget = st.categories.reduce((a, c) => a + c.items.reduce((b, i) => b + Number(m.budget[i.id] || 0), 0), 0);

  el.innerHTML = `
    <h2>Budget ${esc(monthLabel(ui.month))}</h2>
    <div class="card">
      <h3>Saldo & pemasukan</h3>
      <label>Saldo rekening tabungan bulan lalu (Rp)<input class="num" id="prevBal" inputmode="numeric" value="${fmtInput(m.prevBalance)}"></label>
      <div class="income-row hint" style="margin:0"><span>Sumber</span><span>Proyeksi</span><span>Aktual</span><span></span></div>
      ${m.income.map((x) => `
        <div class="income-row" data-id="${x.id}">
          <input class="iname" value="${esc(x.name)}" aria-label="Nama pemasukan">
          <input class="iproj num" inputmode="numeric" value="${fmtInput(x.projected)}" aria-label="Proyeksi">
          <input class="iact num" inputmode="numeric" value="${fmtInput(x.actual)}" aria-label="Aktual">
          <button class="x" aria-label="Hapus">×</button>
        </div>`).join('')}
      <button class="btn" id="addIncome">+ Sumber pemasukan</button>
    </div>

    <div class="card">
      <h3>Proyeksi pengeluaran · <span class="num">${formatRp(totalBudget)}</span></h3>
      <div class="btn-row"><button class="btn" id="copyPrev">Salin proyeksi dari bulan lalu</button></div>
      ${st.categories.map((c) => {
        const sum = c.items.reduce((b, i) => b + Number(m.budget[i.id] || 0), 0);
        return `<details class="budget-cat" data-cat="${c.id}">
          <summary><span>${esc(c.name)}</span><span class="num">${formatRp(sum)}</span></summary>
          ${c.items.map((i) => `<div class="budget-item"><span>${esc(i.name)}${i.fixed ? ' <span class="badge">Fixed</span>' : ''}${i.recurring ? ' <span class="badge rutin">Rutin</span>' : ''}</span><input class="num bud" data-item="${i.id}" inputmode="numeric" value="${fmtInput(m.budget[i.id])}" placeholder="0"></div>`).join('')}
          <div class="cat-edit">
            <div class="row2">
              <label>Nama kategori<input class="cname" value="${esc(c.name)}"></label>
              <label>Jenis<select class="ctype">${Object.entries(CATEGORY_TYPES).map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            </div>
            <p class="hint">Item & kata kunci (pisahkan dengan koma). Kata kunci dipakai untuk mengenali catatan. Centang <b>Fixed cost</b> untuk item yang dihitung di Fixed Cost (Non Food), dan <b>Rutin</b> untuk item yang diisi lewat tombol "Isi transaksi rutin".</p>
            <label class="check"><input type="checkbox" class="cgood" ${c.overIsGood ? 'checked' : ''}> Melebihi proyeksi = baik (tidak dianggap peringatan)</label>
            ${c.items.map((i) => `<div class="item-edit" data-item="${i.id}"><input class="iname2" value="${esc(i.name)}" aria-label="Nama item"><input class="ikw" value="${esc((i.keywords || []).join(', '))}" placeholder="kata kunci" aria-label="Kata kunci"><label class="check ifix-wrap"><input type="checkbox" class="ifix" ${i.fixed ? 'checked' : ''}> Fixed cost</label><label class="check ifix-wrap"><input type="checkbox" class="irec" ${i.recurring ? 'checked' : ''}> Rutin</label><button class="btn ghost danger idel" aria-label="Hapus item">×</button></div>`).join('')}
            <div class="btn-row"><button class="btn addItem">+ Item</button><span class="spacer"></span><button class="btn ghost danger delCat">Hapus kategori</button></div>
          </div>
        </details>`;
      }).join('')}
      <button class="btn" id="addCat">+ Kategori baru</button>
    </div>`;

  // simpan otomatis saat input berubah
  const saveQuiet = () => { store.save(); toast('Tersimpan.', 1000); };
  const amountInput = (inp, set) => { inp.onchange = () => { set(parseAmount(inp.value)); inp.value = fmtInput(parseAmount(inp.value)); saveQuiet(); }; };
  amountInput($('#prevBal', el), (v) => (m.prevBalance = v));
  $$('.income-row[data-id]', el).forEach((row) => {
    const x = m.income.find((i) => i.id === row.dataset.id);
    $('.iname', row).onchange = (e) => { x.name = e.target.value; saveQuiet(); };
    amountInput($('.iproj', row), (v) => (x.projected = v));
    amountInput($('.iact', row), (v) => (x.actual = v));
    $('.x', row).onclick = () => { m.income = m.income.filter((i) => i !== x); store.save(); renderBudget(); };
  });
  $('#addIncome', el).onclick = () => { m.income.push({ id: store.uid(), name: 'Extra income', projected: 0, actual: 0 }); store.save(); renderBudget(); };
  $('#copyPrev', el).onclick = () => {
    const prev = st.months[shiftMonth(ui.month, -1)];
    if (!prev) return toast('Bulan lalu belum ada data.');
    if (!confirm('Timpa proyeksi bulan ini dengan proyeksi bulan lalu?')) return;
    m.budget = { ...prev.budget }; store.save(); renderBudget(); toast('Proyeksi disalin.');
  };
  $$('.bud', el).forEach((inp) => amountInput(inp, (v) => { if (v) m.budget[inp.dataset.item] = v; else delete m.budget[inp.dataset.item]; }));

  const openSet = new Set($$('details[open]', el).map((d) => d.dataset.cat));
  $$('details.budget-cat', el).forEach((det) => {
    const c = st.categories.find((x) => x.id === det.dataset.cat);
    if (openSet.has(c.id) || ui.openCat === c.id) det.open = true;
    det.ontoggle = () => { if (det.open) ui.openCat = c.id; };
    $('.cname', det).onchange = (e) => { c.name = e.target.value.trim() || c.name; saveQuiet(); };
    $('.ctype', det).onchange = (e) => { c.type = e.target.value; saveQuiet(); };
    $('.cgood', det).onchange = (e) => { c.overIsGood = e.target.checked; saveQuiet(); };
    $$('.item-edit', det).forEach((row) => {
      const it = c.items.find((i) => i.id === row.dataset.item);
      $('.iname2', row).onchange = (e) => { it.name = e.target.value.trim() || it.name; saveQuiet(); };
      $('.ikw', row).onchange = (e) => { it.keywords = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); saveQuiet(); };
      $('.ifix', row).onchange = (e) => { it.fixed = e.target.checked; saveQuiet(); };
      $('.irec', row).onchange = (e) => { it.recurring = e.target.checked; saveQuiet(); };
      $('.idel', row).onclick = () => {
        if (st.transactions.some((t) => t.itemId === it.id)) return toast('Item ini sudah punya transaksi. Pindahkan dulu transaksinya.');
        if (c.items.length === 1) return toast('Kategori minimal punya satu item.');
        if (!confirm(`Hapus item "${it.name}"?`)) return;
        c.items = c.items.filter((i) => i !== it); store.save(); renderBudget();
      };
    });
    $('.addItem', det).onclick = () => { c.items.push({ id: store.uid(), name: 'Item baru', keywords: [] }); ui.openCat = c.id; store.save(); renderBudget(); };
    $('.delCat', det).onclick = () => {
      if (st.transactions.some((t) => t.catId === c.id)) return toast('Kategori ini sudah punya transaksi.');
      if (!confirm(`Hapus kategori "${c.name}"?`)) return;
      st.categories = st.categories.filter((x) => x !== c); store.save(); renderBudget();
    };
  });
  $('#addCat', el).onclick = () => {
    const name = prompt('Nama kategori baru:');
    if (!name) return;
    const id = store.uid();
    st.categories.push({ id, name: name.trim(), type: 'variable', items: [{ id: store.uid(), name: 'Lainnya', keywords: [] }] });
    ui.openCat = id; store.save(); renderBudget();
  };
}

// ---------- pengaturan ----------
function renderSettings() {
  const el = $('#view-settings');
  const st = store.getState();
  const year = ui.month.slice(0, 4);
  const monthsWithData = Object.keys(st.months).sort();
  el.innerHTML = `
    <h2>Pengaturan</h2>
    <div class="card">
      <h3>Export ke Excel</h3>
      <p class="hint">File .xlsx berisi sheet Ringkasan, satu sheet per bulan (susunan seperti template Anda), dan daftar Transaksi.</p>
      <div class="btn-row">
        <button class="btn primary" data-exp="month">${esc(monthLabel(ui.month))}</button>
        <button class="btn" data-exp="year">Tahun ${year}</button>
        <button class="btn" data-exp="all">Semua bulan</button>
      </div>
    </div>

    <div class="card">
      <h3>AI (Claude) untuk item yang tidak dikenali</h3>
      <p class="hint">Kata kunci dicoba dulu. AI hanya dipakai untuk item yang tidak cocok dengan kata kunci atau riwayat. Butuh internet dan API key dari console.anthropic.com (berbayar per pemakaian, kecil untuk teks pendek).
      Kunci disimpan hanya di perangkat ini dan dikirim langsung ke Anthropic.</p>
      <label>API key Claude<input id="apiKey" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(st.settings.apiKey)}"></label>
      <label>Kapan AI dipakai
        <select id="aiMode">
          <option value="unknown" ${st.settings.aiMode !== 'auto' ? 'selected' : ''}>Saat saya tekan tombol "Tanya AI"</option>
          <option value="auto" ${st.settings.aiMode === 'auto' ? 'selected' : ''}>Otomatis setelah catatan diproses</option>
        </select>
      </label>
    </div>

    <div class="card">
      <h3>Kunci aplikasi (PIN)</h3>
      <label class="check"><input type="checkbox" id="pinOn" ${lock.isEnabled() ? 'checked' : ''}> Minta PIN 6 digit saat aplikasi dibuka</label>
      <label>Kunci lagi setelah ditinggal
        <select id="pinAfter" ${lock.isEnabled() ? '' : 'disabled'}>
          ${[[90, '90 detik'], [120, '2 menit'], [300, '5 menit']].map(([v, t]) => `<option value="${v}" ${lock.lockAfterSec() === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </label>
      ${lock.isEnabled() ? '<div class="btn-row"><button class="btn" id="pinChange">Ubah PIN</button></div>' : ''}
      <p class="hint">PIN salah 3 kali = tunggu 5 menit. Lupa PIN = data di perangkat ini harus dihapus, lalu dipulihkan dari backup. Tidak ada jalan pintas, jadi pastikan backup rutin.</p>
    </div>

    <div class="card">
      <h3>Pembacaan angka</h3>
      <label class="check"><input type="checkbox" id="smallK" ${st.settings.smallNumberThousands ? 'checked' : ''}> Angka di bawah 1.000 tanpa satuan dianggap ribuan (kopi 35 → Rp35.000)</label>
      <p class="hint">Riwayat koreksi kategori: <b>${Object.keys(st.learned).length}</b> entri. <button class="btn ghost" id="clearLearned">Hapus riwayat</button></p>
    </div>

    <div class="card">
      <h3>Backup data</h3>
      ${needsBackup() ? `<div class="banner warn"><div><b>${backupAgeDays() === null ? 'Belum pernah backup' : `Backup terakhir ${backupAgeDays()} hari lalu`}</b><br><small>Data hanya ada di perangkat ini. Bagikan backup sekarang.</small></div></div>` : ''}
      <p class="hint">Backup terakhir: <b>${st.settings.lastBackupAt ? `${new Date(st.settings.lastBackupAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} (${backupAgeDays()} hari lalu)` : 'belum pernah'}</b>. Pengingat muncul di sini (dan titik merah di menu Pengaturan) kalau lewat 7 hari.</p>
      <div class="btn-row"><button class="btn primary" id="shareBackup">Bagikan backup (Gmail, WhatsApp, Drive…)</button></div>
      <div class="btn-row">
        <button class="btn" id="backup">Download backup</button>
        <label class="btn" style="margin:0;display:inline-flex;align-items:center">Restore backup<input type="file" id="restore" accept=".txt,.json,text/plain,application/json" hidden></label>
        <span class="spacer"></span>
        <button class="btn ghost danger" id="reset">Hapus semua data</button>
      </div>
      <p class="hint">File berformat .txt dan berisi seluruh data keuangan Anda tanpa enkripsi. Kirim hanya ke email atau Drive milik sendiri.
      Data hanya tersimpan di perangkat ini; jika data Chrome dihapus, data ikut hilang. Bulan tersimpan: ${monthsWithData.length ? monthsWithData.map(monthLabel).join(', ') : '–'}.</p>
    </div>

    <div class="card version">
      <h3>Tentang aplikasi</h3>
      <p><b>Catatan Finansial versi ${APP_VERSION}</b></p>
      <details><summary>Riwayat versi</summary>
        ${CHANGELOG.map((v) => `<p><b>${v.v}</b> · ${esc(v.date)}<br><small>${v.items.map(esc).join('<br>')}</small></p>`).join('')}
      </details>
    </div>`;

  $$('[data-exp]', el).forEach((b) => (b.onclick = async () => {
    const all = Object.keys(st.months);
    const keys = b.dataset.exp === 'month' ? [ui.month] : b.dataset.exp === 'year' ? all.filter((k) => k.startsWith(year)) : all;
    if (!keys.length) return toast('Belum ada data.');
    b.disabled = true;
    try { const r = await exportExcel(keys); if (r !== 'cancelled') toast(r === 'shared' ? 'File Excel dibagikan.' : 'File Excel diunduh.'); } catch (e) { toast('Export gagal: ' + e.message); }
    b.disabled = false;
  }));
  $('#apiKey', el).onchange = (e) => { st.settings.apiKey = e.target.value.trim(); store.save(); toast('API key disimpan.'); };
  $('#aiMode', el).onchange = (e) => { st.settings.aiMode = e.target.value; store.save(); };
  $('#smallK', el).onchange = (e) => { st.settings.smallNumberThousands = e.target.checked; store.save(); };
  $('#pinOn', el).onchange = async (e) => {
    const want = e.target.checked;
    const ok = want ? await lock.enableFlow() : await lock.disableFlow();
    toast(ok ? (want ? 'PIN aktif.' : 'PIN dimatikan.') : 'Dibatalkan.');
    renderSettings();
  };
  $('#pinAfter', el).onchange = (e) => { lock.setLockAfter(Number(e.target.value)); toast('Tersimpan.'); };
  const pc = $('#pinChange', el);
  if (pc) pc.onclick = async () => { toast((await lock.changeFlow()) ? 'PIN diganti.' : 'Dibatalkan.'); };
  $('#clearLearned', el).onclick = () => { if (confirm('Hapus semua riwayat koreksi kategori?')) { st.learned = {}; store.save(); renderSettings(); } };
  $('#backup', el).onclick = () => { downloadBackup(); renderSettings(); };
  $('#shareBackup', el).onclick = shareBackup;
  $('#restore', el).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Restore akan mengganti semua data di perangkat ini. Lanjut?')) return;
    try {
      const key = st.settings.apiKey;
      store.importJSON(await file.text());
      if (!store.getState().settings.apiKey) { store.getState().settings.apiKey = key; store.save(); }
      toast('Backup dipulihkan.'); render();
    } catch (err) { toast('Gagal: ' + err.message); }
  };
  $('#reset', el).onclick = () => {
    if (!confirm('Hapus SEMUA data (transaksi, budget, kategori)? Tidak bisa dibatalkan.')) return;
    store.resetAll(); toast('Semua data dihapus.'); render();
  };
}

// ---------- init ----------
$('#prevMonth').onclick = () => setMonth(shiftMonth(ui.month, -1));
$('#nextMonth').onclick = () => setMonth(shiftMonth(ui.month, 1));
$('#monthPicker').onchange = (e) => e.target.value && setMonth(e.target.value);
$$('.bottomnav button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));

store.ensureMonth(ui.month);

// Teks yang dibagikan dari aplikasi Notes (Android "Bagikan" → Catatan Finansial)
const params = new URLSearchParams(location.search);
const shared = [params.get('title'), params.get('text')].filter(Boolean).join('\n');
let startView = 'dashboard';
try { startView = localStorage.getItem('catfin.view') || 'dashboard'; } catch {}
if (shared) {
  try { localStorage.setItem('catfin.draft', shared); } catch {}
  history.replaceState(null, '', location.pathname);
  startView = 'input';
}
setView(startView);

function forgotPin() {
  if (!confirm('Lupa PIN?\n\nSatu-satunya cara: SEMUA data di perangkat ini dihapus, lalu Anda pulihkan dari file backup (Pengaturan → Restore backup).')) return;
  if (!confirm('Yakin? Transaksi, budget, dan kategori di perangkat ini akan dihapus permanen.')) return;
  store.resetAll();
  lock.clearLock();
  location.reload();
}
lock.initAutoLock(forgotPin);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
