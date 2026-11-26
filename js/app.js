import { parseNotes, categorize, normalizeText } from './parser.js';
import * as store from './store.js';
import { exportExcel } from './export.js';
import { categorizeWithAI } from './ai.js';
import * as lock from './lock.js';
import { APP_VERSION } from './version.js';
import {
  t, setLang, getLang, setNumberFormat, groupSep, groupDigits, rp, fmtInput, pct, monthLabel, shortMonth, fmtDate,
} from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseAmount = (v) => Number(String(v).replace(/[^\d-]/g, '')) || 0;
const pct0 = (v) => `${Math.round(v * 100)}%`;

store.load();
const applyPrefs = () => {
  const s = store.getState().settings;
  setLang(s.lang);
  setNumberFormat(s.numberFormat);
};
applyPrefs();

// ---------- pemisah ribuan otomatis untuk semua kolom nominal (inputmode="numeric") ----------
function liveFormat(inp) {
  const pos = inp.selectionStart ?? inp.value.length;
  const digitsBefore = inp.value.slice(0, pos).replace(/\D/g, '').length;
  const digits = inp.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const out = groupDigits(digits);
  if (out === inp.value) return;
  inp.value = out;
  let caret = 0, seen = 0; // kembalikan kursor ke posisi setelah digit yang sama
  while (caret < out.length && seen < digitsBefore) { if (/\d/.test(out[caret])) seen++; caret++; }
  try { inp.setSelectionRange(caret, caret); } catch {}
}
const isAmount = (el) => el instanceof HTMLInputElement && el.inputMode === 'numeric';
document.addEventListener('beforeinput', (e) => {
  const inp = e.target;
  if (!isAmount(inp) || e.inputType !== 'deleteContentBackward') return;
  const p = inp.selectionStart;
  // Hapus mundur tepat setelah pemisah: hapus angka sebelum pemisah, bukan pemisahnya.
  if (p === inp.selectionEnd && p > 1 && inp.value[p - 1] === groupSep()) {
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
  toast(t('bk.dl'));
}
async function shareBackup() {
  const file = backupFile();
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: t('bk.title') });
      store.markBackup();
      toast(t('bk.shared'));
      render();
    } catch (e) {
      if (e.name !== 'AbortError') toast(t('bk.shareFail', { e: e.message }));
    }
    return;
  }
  toast(t('bk.noShare'));
  downloadBackup();
  render();
}
function backupAgeDays() {
  const ts = store.getState().settings.lastBackupAt;
  return ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : null;
}
function needsBackup() {
  const age = backupAgeDays();
  return store.getState().transactions.length > 0 && (age === null || age > 7);
}

const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

const ui = {
  view: 'dashboard',
  month: store.monthKey(),
  review: null,
  expanded: new Set(),
  openCat: null,
  editCat: null,
  txFilter: { cat: '', q: '' },
};

// ---------- util ----------
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
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
  return (blank ? `<option value="">— ${esc(t('rv.pick'))} —</option>` : '') +
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
  return store.monthKey(today) === ui.month ? today.toISOString().slice(0, 10) : '';
}

/** Tingkat status budget untuk satu kategori (dipakai bar dan persentase). */
function levelOf(c, good) {
  if (!c.projected) return { cls: c.actual > 0 && !good ? 'none' : 'base', ratio: null, w: 0 };
  const r = c.actual / c.projected;
  let cls = 'base';
  if (good) cls = r > 1 ? 'good' : 'base';
  else if (r >= 1) cls = 'bad';
  else if (r >= 0.8) cls = 'warn';
  return { cls, ratio: r, w: Math.min(r, 1) };
}

// ---------- navigasi ----------
function applyStaticText() {
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
}

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
  $('.bottomnav [data-view="settings"]').classList.toggle('dot', needsBackup());
  $('#monthLabel').textContent = monthLabel(ui.month);
  $('#monthPicker').value = ui.month;
}

function render() {
  renderHeader();
  ({ dashboard: renderDashboard, input: renderInput, tx: renderTx, budget: renderBudget, settings: renderSettings })[ui.view]();
}

const pageHead = (title, sub, right = '') => `<div class="page-head"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${right}</div>`;

// ---------- dashboard ----------
function donutSVG(slices, total) {
  const R = 100, r = 74, cx = 120, cy = 120, gap = 0.014;
  if (!total) return `<svg viewBox="0 0 240 240" role="img" aria-label="${esc(t('d.empty'))}"><circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="var(--surface-2)" stroke-width="${R - r}"/></svg>`;
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
    return `<path data-id="${s.id}" fill="${s.color}" d="M${p(R, s0)}A${R},${R} 0 ${large},1 ${p(R, s1)}L${p(r, s1)}A${r},${r} 0 ${large},0 ${p(r, s0)}Z"><title>${esc(s.name)}: ${rp(s.value)} (${pct(frac)})</title></path>`;
  });
  return `<svg viewBox="0 0 240 240" role="img" aria-label="${esc(t('d.byCat'))}">${paths.join('')}</svg>`;
}

const juta = (v) => `${(v / 1e6).toLocaleString(getLang() === 'id' ? 'id-ID' : 'en-GB', { maximumFractionDigits: 1 })}${t('tr.M')}`;
function niceMax(v) {
  if (v <= 0) return 1e6;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((f) => f * p).find((x) => x >= v);
}

function trendHTML() {
  const data = store.trend(ui.month, 12);
  if (data.length < 2) return `<div class="card"><h3>${t('tr.title')}</h3><p class="hint">${t('tr.need2')}</p></div>`;

  // Grafik 1: pemasukan vs pengeluaran (batang berdampingan, satu sumbu Rupiah)
  const W = 420, H = 180, L = 40, B = 150, T = 14;
  const max = niceMax(Math.max(...data.flatMap((d) => [d.income, d.expense])));
  const slot = (W - L - 4) / data.length;
  const bw = Math.min(16, (slot - 8) / 2);
  const yv = (v) => B - (v / max) * (B - T);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" y1="${yv(max * f)}" x2="${W}" y2="${yv(max * f)}" class="grid"/><text x="${L - 5}" y="${yv(max * f) + 3}" class="ax" text-anchor="end">${f ? juta(max * f) : '0'}</text>`).join('');
  const bars = data.map((d, i) => {
    const x = L + i * slot + (slot - 2 * bw - 3) / 2;
    const r = (v, xx, cls) => (v > 0 ? `<rect x="${xx}" y="${yv(v)}" width="${bw}" height="${B - yv(v)}" rx="3" class="${cls}"/>` : '');
    return `<g class="tbar ${d.key === ui.month ? 'cur' : ''}" data-i="${i}">
      <rect x="${L + i * slot}" y="${T}" width="${slot}" height="${B - T + 18}" class="hit"/>
      ${r(d.income, x, 'b-inc')}${r(d.expense, x + bw + 3, 'b-exp')}
      <text x="${L + i * slot + slot / 2}" y="${B + 14}" class="ax" text-anchor="middle">${shortMonth(d.key)}</text></g>`;
  }).join('');

  // Grafik 2: saving ratio (garis, sumbu persen sendiri)
  const W2 = 330, H2 = 180, B2 = 150, T2 = 16, L2 = 36;
  const slot2 = (W2 - L2 - 4) / data.length;
  const rmax = Math.max(0.5, ...data.map((d) => d.savingRatio || 0));
  const ry = (v) => B2 - (v / rmax) * (B2 - T2);
  const pts = data.map((d, i) => (d.savingRatio == null ? null : [L2 + i * slot2 + slot2 / 2, ry(d.savingRatio), d])).filter(Boolean);
  const grid2 = [0, 0.5, 1].map((f) => `<line x1="${L2}" y1="${ry(rmax * f)}" x2="${W2}" y2="${ry(rmax * f)}" class="grid"/><text x="${L2 - 5}" y="${ry(rmax * f) + 3}" class="ax" text-anchor="end">${Math.round(rmax * f * 100)}%</text>`).join('');
  const last = pts[pts.length - 1];
  const line = pts.length ? `<polyline points="${pts.map((p) => p.slice(0, 2).join(',')).join(' ')}" class="l-sav"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2].key === ui.month ? 5 : 3.5}" class="d-sav"><title>${shortMonth(p[2].key)}: ${pct(p[2].savingRatio)}</title></circle>`).join('')}${last ? `<text x="${last[0]}" y="${last[1] - 10}" class="lbl" text-anchor="end">${pct(last[2].savingRatio)}</text>` : ''}` : '';
  const months2 = data.map((d, i) => `<text x="${L2 + i * slot2 + slot2 / 2}" y="${B2 + 14}" class="ax" text-anchor="middle">${shortMonth(d.key)}</text>`).join('');

  const cmp = store.compareWithPrevious(ui.month);
  const colors = catColorMap();
  const cmpRows = cmp.rows.map((r) => {
    const up = r.delta > 0;
    const good = r.overIsGood ? up : !up;
    const change = r.delta ? `<span class="${good ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${rp(Math.abs(r.delta))}</span>` : '–';
    return `<div class="cmp"><span class="dot" style="background:${colors[r.id]}"></span><span class="nm">${esc(r.name)}</span><span class="num muted hide-sm">${rp(r.prev)}</span><span class="num">${rp(r.cur)}</span><span class="num">${change}</span></div>`;
  }).join('');

  return `
    <div class="two">
      <div class="card">
        <h3>${t('tr.incExp')}</h3>
        <div class="legend-row"><span><i class="sw b-inc"></i>${t('tr.income')}</span><span><i class="sw b-exp"></i>${t('tr.expense')}</span></div>
        <svg class="tchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('tr.incExp'))}">${grid}${bars}</svg>
        <p class="tinfo" id="tinfo">${t('tr.tap')}</p>
        <table class="mini-table sr-table"><thead><tr><th>${t('tr.month')}</th><th>${t('tr.income')}</th><th>${t('tr.expense')}</th><th>${t('tr.saving')}</th></tr></thead><tbody>
          ${data.map((d) => `<tr><td>${esc(monthLabel(d.key))}</td><td class="num">${rp(d.income)}</td><td class="num">${rp(d.expense)}</td><td class="num">${pct(d.savingRatio)}</td></tr>`).join('')}
        </tbody></table>
        <button class="btn ghost sm" id="toggleTrendTable">${t('tr.showTable')}</button>
      </div>
      <div class="card">
        <h3>${t('tr.savRatio')}</h3>
        <div class="legend-row"><span><i class="sw l-sav-sw"></i>${t('tr.savRatio')}</span></div>
        <svg class="tchart" viewBox="0 0 ${W2} ${H2}" role="img" aria-label="${esc(t('tr.savRatio'))}">${grid2}${line}${months2}</svg>
      </div>
    </div>
    <div class="card">
      <h3>${t('tr.vs', { m: esc(monthLabel(cmp.prevKey)) })}</h3>
      ${cmpRows ? `<div class="cmp head"><span></span><span>${t('tr.cat')}</span><span class="hide-sm">${esc(shortMonth(cmp.prevKey))}</span><span>${esc(shortMonth(ui.month))}</span><span>${t('tr.change')}</span></div>${cmpRows}` : `<p class="hint">${t('tr.noCmp')}</p>`}
      <p class="hint">${t('tr.cmpHint')}</p>
    </div>`;
}

function bindTrend(el) {
  const data = store.trend(ui.month, 12);
  const info = $('#tinfo', el);
  $$('.tbar', el).forEach((g) => {
    const show = () => {
      const d = data[+g.dataset.i];
      $$('.tbar', el).forEach((x) => x.classList.toggle('on', x === g));
      info.innerHTML = `<b>${esc(monthLabel(d.key))}</b> · ${t('tr.income')} <b class="num">${rp(d.income)}</b> · ${t('tr.expense')} <b class="num">${rp(d.expense)}</b> · ${t('tr.balance')} <b class="num ${d.income - d.expense < 0 ? 'neg' : 'pos'}">${rp(d.income - d.expense)}</b>`;
    };
    g.addEventListener('mouseenter', show);
    g.addEventListener('click', show);
  });
  const tg = $('#toggleTrendTable', el);
  if (tg) tg.onclick = () => { const tb = $('.sr-table', el); tb.classList.toggle('show'); tg.textContent = tb.classList.contains('show') ? t('tr.hideTable') : t('tr.showTable'); };
}

function renderDashboard() {
  const s = store.summarize(ui.month);
  const st = store.getState();
  const colors = catColorMap(s);
  const el = $('#view-dashboard');

  const withSpend = s.cats.filter((c) => c.actual > 0).sort((a, b) => b.actual - a.actual);
  const total = withSpend.reduce((a, c) => a + c.actual, 0);
  let slices = withSpend.map((c) => ({ id: c.id, name: c.name, value: c.actual, color: colors[c.id] }));
  const overflow = slices.filter((x) => x.color === 'var(--s-other)');
  if (overflow.length > 1) {
    slices = slices.filter((x) => x.color !== 'var(--s-other)');
    slices.push({ id: '_other', name: t('c.others'), value: overflow.reduce((a, x) => a + x.value, 0), color: 'var(--s-other)' });
  }

  const planRatio = s.totalProjected ? s.totalActual / s.totalProjected : null;
  const planCls = planRatio == null ? 'base' : planRatio >= 1 ? 'bad' : planRatio >= 0.8 ? 'warn' : 'ok';
  const good = (id) => !!st.categories.find((x) => x.id === id)?.overIsGood;
  const rows = s.cats.filter((c) => c.actual || c.projected).sort((a, b) => b.actual - a.actual || b.projected - a.projected);
  const ratio = (label, value, sub) => `<div class="card ratio"><div class="lbl">${label}</div><div class="mid num">${value}</div><div class="sub num">${sub}</div></div>`;

  el.innerHTML = `
    <div class="card hero">
      <div>
        <div class="lbl">${t('d.balance')}</div>
        <div class="big num ${s.balance < 0 ? 'neg' : ''}">${rp(s.balance)}</div>
        <div class="sub">${t('d.balanceSub', { inc: `<b class="num">${rp(s.incomeActual)}</b>`, exp: `<b class="num">${rp(s.totalActual)}</b>` })}</div>
        ${s.month.prevBalance ? `<div class="sub">${t('d.opening', { v: `<b class="num">${rp(s.month.prevBalance)}</b>` })}</div>` : ''}
      </div>
      <div class="hero-r">
        <div class="lbl">${t('d.vsPlan')}</div>
        ${planRatio == null ? `<div class="sub">${t('d.noPlan')}</div>` : `
          <div class="mid num ${planCls === 'bad' ? 'neg' : planCls === 'warn' ? 'warnt' : ''}">${pct0(planRatio)} <small>${t('d.ofPlan', { v: rp(s.totalProjected) })}</small></div>
          <div class="pbar"><i class="${planCls}" style="width:${Math.min(planRatio, 1) * 100}%"></i></div>`}
      </div>
    </div>

    <div class="ratios">
      ${ratio(t('d.saving'), pct(s.savingRatio), rp(s.savingActual))}
      ${ratio(t('d.fixed'), pct(s.fixedRatio), rp(s.fixedActual))}
      ${ratio(t('d.food'), pct(s.foodRatio), rp(s.foodActual))}
    </div>

    <div class="card">
      <h3>${t('d.byCat')}</h3>
      ${total ? '' : `<p class="hint">${t('d.empty')}</p>`}
      <div class="chart-wrap">
        <div class="donut" id="donut">
          ${donutSVG(slices, total)}
          <div class="donut-center"><span class="big2 num" id="dcBig">${rp(total)}</span><span class="small" id="dcSmall">${t('d.totalActual')}</span></div>
        </div>
        <ul class="legend" id="legend">
          ${slices.map((x) => `<li data-id="${x.id}"><span class="sw" style="background:${x.color}"></span><span>${esc(x.name)}</span><span class="num">${rp(x.value)}</span><span class="pct num">${pct(x.value / total)}</span></li>`).join('')}
        </ul>
      </div>
    </div>

    <div class="card">
      <h3>${t('d.cats')}</h3>
      ${rows.map((c) => {
        const g = good(c.id);
        const l = levelOf(c, g);
        const open = ui.expanded.has(c.id);
        return `<div class="crow ${open ? 'open' : ''}" data-cat="${c.id}" role="button" tabindex="0">
            <span class="dot" style="background:${colors[c.id]}"></span>
            <span class="cname">${esc(c.name)}</span>
            <span class="cval num">${rp(c.actual)}<small> / ${c.projected ? rp(c.projected) : '–'}</small></span>
            <span class="cbar"><i class="${l.cls}" style="width:${(l.w * 100).toFixed(0)}%"></i></span>
            <span class="cpct num ${l.cls}">${l.ratio == null ? (l.cls === 'none' ? t('d.noBudget') : '–') : pct0(l.ratio)}</span>
          </div>
          ${open ? `<div class="citems">${c.items.filter((i) => i.projected || i.actual).map((i) => `<div class="citem"><span>${esc(i.name)}</span><span class="num">${rp(i.actual)}<small> / ${i.projected ? rp(i.projected) : '–'}</small></span><span class="num ${i.diff < 0 && !g ? 'neg' : 'muted'}">${rp(i.diff)}</span></div>`).join('') || `<div class="citem muted">${t('d.noItems')}</div>`}</div>` : ''}`;
      }).join('')}
      <div class="crow total"><span></span><span class="cname">${t('c.total')}</span><span class="cval num">${rp(s.totalActual)}<small> / ${rp(s.totalProjected)}</small></span><span></span><span class="cpct num ${planCls === 'bad' ? 'bad' : planCls === 'warn' ? 'warn' : ''}">${planRatio == null ? '–' : pct0(planRatio)}</span></div>
      <p class="hint">${t('d.catsHint')}</p>
    </div>

    ${trendHTML()}`;

  bindTrend(el);

  // sorot donut & legenda saat disentuh
  const donut = $('#donut', el);
  const highlight = (id) => {
    donut.classList.toggle('hovering', !!id);
    $$('path', donut).forEach((p) => p.classList.toggle('on', p.dataset.id === id));
    $$('#legend li', el).forEach((li) => li.classList.toggle('on', li.dataset.id === id));
    const sl = slices.find((x) => x.id === id);
    $('#dcBig', el).textContent = sl ? rp(sl.value) : rp(total);
    $('#dcSmall', el).textContent = sl ? `${sl.name} · ${pct(sl.value / total)}` : t('d.totalActual');
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
  $$('.crow[data-cat]', el).forEach((row) => {
    const toggle = () => {
      const id = row.dataset.cat;
      ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id);
      renderDashboard();
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

// ---------- input notes ----------
function buildReview(text) {
  const st = store.getState();
  const [y] = ui.month.split('-').map(Number);
  const { entries, skipped } = parseNotes(text, { refYear: y, smallNumberThousands: st.settings.smallNumberThousands });
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
  if (ui.review) return renderReview(el, st);

  const draft = (() => { try { return localStorage.getItem('catfin.draft') || ''; } catch { return ''; } })();
  const month = store.ensureMonth(ui.month);
  const recItems = st.categories.flatMap((c) => c.items.filter((i) => i.recurring).map((i) => i.name));
  const filled = month.recurringFilledAt ? fmtDate(month.recurringFilledAt, { day: 'numeric', month: 'short' }) : null;
  const lines = draft.split('\n').filter((l) => l.trim()).length;

  el.innerHTML = `
    ${pageHead(t('nav.input'), t('in.sub', { m: `<b>${esc(monthLabel(ui.month))}</b>` }))}
    <div class="card rut">
      <div>
        <b>${t('in.rec')}</b> ${recItems.length ? `<span class="chip ${filled ? 'ok' : ''}">${filled ? t('in.recFilled', { d: esc(filled) }) : t('in.recNot')}</span>` : ''}
        <div class="sub">${recItems.length ? recItems.map(esc).join(' · ') : t('in.recNone')}</div>
      </div>
      <div class="row"><button class="btn ghost sm" id="recurManage">${t('in.recManage')}</button><button class="btn" id="recurBtn">${t('in.recBtn')}</button></div>
    </div>
    <div class="card">
      <div class="row"><b>${t('in.paste')}</b><span class="spacer"></span><button class="btn ghost sm" id="clearBtn">${t('in.clear')}</button><button class="btn sm" id="pasteBtn">${t('in.fromClip')}</button></div>
      <div class="fmt"><code>Kopi 35000</code><code>Bensin 150rb</code><code>Listrik 503.000</code><code>12/11 sate 45k</code><code>+ Gaji 70jt</code></div>
      <textarea id="notesText" aria-label="${esc(t('in.paste'))}" placeholder="Kopi 35000&#10;Bensin 150rb&#10;Listrik 503.000&#10;Sedekah jumat 100rb">${esc(draft)}</textarea>
      <p class="hint">${t('in.formatHint')}</p>
      <div class="row"><span class="sub" id="lineCount">${t('in.lines', { n: lines })}</span><span class="spacer"></span><button class="btn primary" id="parseBtn">${t('in.process')}</button></div>
    </div>
    <div class="card rut">
      <div><b>${t('in.single')}</b><div class="sub">${t('in.singleSub')}</div></div>
      <button class="btn" id="manualBtn">${t('in.singleBtn')}</button>
    </div>`;

  const ta = $('#notesText', el);
  ta.addEventListener('input', () => {
    try { localStorage.setItem('catfin.draft', ta.value); } catch {}
    $('#lineCount', el).textContent = t('in.lines', { n: ta.value.split('\n').filter((l) => l.trim()).length });
  });
  $('#pasteBtn', el).onclick = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      ta.value = (ta.value ? ta.value + '\n' : '') + txt;
      ta.dispatchEvent(new Event('input'));
    } catch {
      toast(t('in.clipFail'));
    }
  };
  $('#clearBtn', el).onclick = () => { ta.value = ''; ta.dispatchEvent(new Event('input')); };
  $('#parseBtn', el).onclick = () => {
    if (!ta.value.trim()) return toast(t('in.emptyNotes'));
    buildReview(ta.value);
    if (!ui.review.rows.length) { ui.review = null; return toast(t('in.noAmounts')); }
    renderInput();
    maybeAutoAI();
  };
  $('#manualBtn', el).onclick = () => openTxDialog(null);
  $('#recurManage', el).onclick = () => { ui.openCat = null; ui.editCat = null; setView('budget'); toast(t('in.recHow'), 5000); };
  $('#recurBtn', el).onclick = startRecurring;
}

function renderReview(el, st) {
  const rows = ui.review.rows;
  const rutin = ui.review.kind === 'rutin';
  const unknown = rows.filter((r) => r.include && !r.isIncome && !r.catId).length;
  const included = rows.filter((r) => r.include);
  const sumExp = included.filter((r) => !r.isIncome).reduce((a, r) => a + r.amount, 0);
  const sumInc = included.filter((r) => r.isIncome).reduce((a, r) => a + r.amount, 0);
  const month = store.ensureMonth(ui.month);
  const badge = (r) => (r.isIncome ? `<span class="chip acc">${t('b.income')}</span>`
    : r.source === 'learned' ? `<span class="chip ok">${t('b.learned')}</span>`
    : r.source === 'keyword' ? `<span class="chip">${t('b.keyword')}</span>`
    : r.source === 'ai' ? `<span class="chip ai">${t('b.ai')}</span>`
    : r.source === 'manual' ? `<span class="chip">${t('b.manual')}</span>`
    : r.source === 'rutin' ? `<span class="chip acc">${t('b.rutin')}</span>`
    : `<span class="chip warn">${t('b.none')}</span>`);

  el.innerHTML = `
    ${pageHead(rutin ? t('rv.recTitle', { m: esc(monthLabel(ui.month)) }) : t('rv.title'), rutin ? t('rv.recSub') : t('rv.sub', { n: rows.length }),
      `<button class="btn ghost" id="backBtn">${rutin ? t('rv.cancel') : t('rv.back')}</button>`)}
    ${unknown ? `<p class="hint m0">${st.settings.apiKey ? t('rv.hintAi') : t('rv.hintNoKey')}</p>` : ''}
    ${ui.review.skipped.length ? `<div class="card note"><b>${t('rv.skipped')}</b> <span class="sub">${ui.review.skipped.map(esc).join(' · ')}</span></div>` : ''}
    <div class="card list">
      ${rows.map((r, i) => `
        <div class="rv2 ${!r.include ? 'off' : ''} ${r.include && !r.isIncome && !r.catId ? 'unk' : ''}" data-i="${i}">
          <input type="checkbox" class="inc" ${r.include ? 'checked' : ''} aria-label="${esc(t('rv.include'))}">
          <input class="desc plain" value="${esc(r.desc)}" aria-label="${esc(t('dl.desc'))}">
          <input class="amt plain num" inputmode="numeric" value="${fmtInput(r.amount)}" aria-label="${esc(t('dl.amount'))}">
          <div class="sel">
            ${r.isIncome
              ? `<select class="income-line">${month.income.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}<option value="_new">${esc(t('rv.newIncome'))}</option></select>`
              : `<select class="cat ${r.catId ? '' : 'need'}" aria-label="${esc(t('dl.cat'))}">${catOptions(r.catId, { blank: true })}</select>${r.catId ? `<select class="item" aria-label="${esc(t('dl.item'))}">${itemOptions(r.catId, r.itemId)}</select>` : ''}`}
            ${badge(r)}${r.date ? `<span class="raw">${esc(r.date)}</span>` : ''}${r.assumedThousands ? `<span class="chip warn">${t('b.thousands')}</span>` : ''}${r.raw ? `<span class="raw">“${esc(r.raw)}”</span>` : ''}
          </div>
        </div>`).join('')}
    </div>
    <div class="summary-bar">
      <span>${t('c.total')} <b class="num">${rp(sumExp)}</b>${sumInc ? ` · ${t('rv.income')} <b class="num">${rp(sumInc)}</b>` : ''}${unknown ? ` <span class="sub">· ${t('rv.unk', { n: unknown })}</span>` : ''}</span>
      <span class="spacer"></span>
      ${unknown ? `<button class="btn" id="aiBtn">${t('rv.ai', { n: unknown })}</button>` : ''}
      <button class="btn primary" id="saveBtn" ${unknown ? 'disabled' : ''}>${t('rv.save', { n: included.length })}</button>
    </div>`;

  $$('.rv2', el).forEach((card) => {
    const r = rows[+card.dataset.i];
    $('.inc', card).onchange = (e) => { r.include = e.target.checked; renderInput(); };
    $('.desc', card).onchange = (e) => { r.desc = e.target.value.trim(); };
    $('.amt', card).onchange = (e) => { r.amount = parseAmount(e.target.value); renderInput(); };
    const cat = $('.cat', card);
    if (cat) {
      cat.onchange = () => {
        const c = st.categories.find((x) => x.id === cat.value);
        r.catId = cat.value || null;
        r.itemId = c ? (c.items.find((i) => /lainnya|other/i.test(i.name)) || c.items[0]).id : null;
        r.touched = true; r.source = 'manual';
        renderInput();
      };
      const item = $('.item', card);
      if (item) item.onchange = (e) => { r.itemId = e.target.value; r.touched = true; r.source = 'manual'; renderInput(); };
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
  if (!st.settings.apiKey) { toast(t('ai.needKey')); return; }
  const targets = ui.review.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include && !r.isIncome && !r.catId);
  if (!targets.length) return;
  if (btn) { btn.disabled = true; btn.textContent = t('rv.asking'); }
  try {
    const res = await categorizeWithAI(targets.map(({ r }) => r), st.categories, st.settings.apiKey);
    for (const x of res) {
      const tg = targets[x.index];
      if (tg) Object.assign(tg.r, { catId: x.catId, itemId: x.itemId, source: 'ai' });
    }
    toast(t('ai.done', { a: res.length, b: targets.length }));
  } catch (e) {
    toast(t('ai.fail', { e: e.message || e }), 5000);
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
  if (!rows.length) return toast(t('in.recNone'));
  if (month.recurringFilledAt) {
    const d = fmtDate(month.recurringFilledAt, { day: 'numeric', month: 'short' });
    if (!confirm(t('rec.again', { m: monthLabel(ui.month), d }))) return;
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
      if (!line) { line = { id: store.uid(), name: r.desc || t('bu.extra'), projected: 0, actual: 0 }; month.income.push(line); }
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
  const wasNotes = !ui.review.kind;
  ui.review = null;
  if (wasNotes) { try { localStorage.removeItem('catfin.draft'); } catch {} }
  toast(t('sv.done', { n: nTx }) + (nInc ? t('sv.inc', { n: nInc }) : '') + '.');
  setView('dashboard');
}

// ---------- transaksi ----------
function renderTx() {
  const el = $('#view-tx');
  const st = store.getState();
  const colors = catColorMap();
  const q = normalizeText(ui.txFilter.q);
  const list = st.transactions
    .filter((x) => x.month === ui.month)
    .filter((x) => !ui.txFilter.cat || x.catId === ui.txFilter.cat)
    .filter((x) => !q || normalizeText(x.desc).includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const total = list.reduce((a, x) => a + x.amount, 0);

  const groups = new Map();
  for (const x of list) {
    const k = x.date || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const dateLabel = (d) => (d ? fmtDate(d + 'T00:00', { weekday: 'long', day: 'numeric', month: 'short' }) : t('tx.noDate'));

  el.innerHTML = `
    ${pageHead(t('nav.tx'), `${t('tx.count', { n: list.length })} · <b class="num">${rp(total)}</b>`, `<button class="btn primary" id="addTx">${t('tx.add')}</button>`)}
    <div class="filters">
      <select id="fCat" aria-label="${esc(t('dl.cat'))}"><option value="">${t('tx.allCats')}</option>${catOptions(ui.txFilter.cat)}</select>
      <input id="fQ" type="search" placeholder="${esc(t('tx.search'))}" value="${esc(ui.txFilter.q)}" aria-label="${esc(t('tx.search'))}">
    </div>
    ${list.length ? `<div class="card list">${[...groups].map(([d, items]) => `
      <div class="dayh"><span>${esc(dateLabel(d))}</span><span class="num">${rp(items.reduce((a, x) => a + x.amount, 0))}</span></div>
      ${items.map((x) => {
        const { cat, item } = store.findItem(x.catId, x.itemId);
        return `<button class="tx2" data-id="${x.id}"><span class="dot round" style="background:${colors[x.catId] || 'var(--s-other)'}"></span><span class="d"><b>${esc(x.desc)}</b><small>${esc(cat?.name || '?')} · ${esc(item?.name || '?')}${x.source === 'rutin' ? ` · ${t('b.rutin')}` : ''}</small></span><span class="num">${rp(x.amount)}</span></button>`;
      }).join('')}`).join('')}</div>` : `<div class="empty">${t('tx.empty')}</div>`}`;

  $('#fCat', el).onchange = (e) => { ui.txFilter.cat = e.target.value; renderTx(); };
  const fq = $('#fQ', el);
  fq.oninput = () => { ui.txFilter.q = fq.value; clearTimeout(renderTx._t); renderTx._t = setTimeout(() => { renderTx(); const n = $('#fQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $('#addTx', el).onclick = () => openTxDialog(null);
  $$('.tx2', el).forEach((b) => (b.onclick = () => openTxDialog(st.transactions.find((x) => x.id === b.dataset.id))));
}

function openTxDialog(tx) {
  const dlg = $('#txDialog');
  const f = $('#txForm');
  const st = store.getState();
  applyStaticText();
  $('#txDialogTitle').textContent = tx ? t('dl.edit') : t('dl.add');
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
    if (!confirm(t('dl.confirmDel'))) return;
    st.transactions = st.transactions.filter((x) => x.id !== tx.id);
    store.save(); dlg.close(); toast(t('dl.deleted')); render();
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    const amount = parseAmount(f.amount.value);
    if (!f.desc.value.trim() || !amount) return toast(t('dl.need'));
    const data = { desc: f.desc.value.trim(), amount, date: f.date.value, catId: f.catId.value, itemId: f.itemId.value };
    if (data.date) data.month = data.date.slice(0, 7);
    if (tx) Object.assign(tx, data);
    else st.transactions.push({ id: store.uid(), month: data.month || ui.month, source: 'manual', createdAt: Date.now(), ...data });
    if (f.learn.checked) learn(data.desc, data.catId, data.itemId);
    if (data.month) store.ensureMonth(data.month);
    store.save(); dlg.close(); toast(t('c.saved')); render();
  };
  dlg.showModal();
}

// ---------- budget ----------
function renderBudget() {
  const el = $('#view-budget');
  const st = store.getState();
  const m = store.ensureMonth(ui.month);
  const colors = catColorMap();
  const sumCat = (c) => c.items.reduce((b, i) => b + Number(m.budget[i.id] || 0), 0);
  const totalBudget = st.categories.reduce((a, c) => a + sumCat(c), 0);
  const types = ['food', 'saving', 'variable'];

  el.innerHTML = `
    ${pageHead(t('nav.budget'), t('bu.sub', { m: esc(monthLabel(ui.month)) }))}
    <div class="card">
      <h3>${t('bu.balInc')}</h3>
      <div class="inc"><span>${t('bu.prevBal')}</span><span class="hide-sm"></span><input class="num ni" id="prevBal" inputmode="numeric" value="${fmtInput(m.prevBalance)}" placeholder="0" aria-label="${esc(t('bu.prevBal'))}"><span></span></div>
      <div class="inc head"><span>${t('bu.source')}</span><span>${t('bu.plan')}</span><span>${t('bu.actual')}</span><span></span></div>
      ${m.income.map((x) => `
        <div class="inc" data-id="${x.id}">
          <input class="iname plain" value="${esc(x.name)}" aria-label="${esc(t('bu.incName'))}">
          <input class="iproj num ni" inputmode="numeric" value="${fmtInput(x.projected)}" placeholder="0" aria-label="${esc(t('bu.plan'))}">
          <input class="iact num ni" inputmode="numeric" value="${fmtInput(x.actual)}" placeholder="0" aria-label="${esc(t('bu.actual'))}">
          <button class="x" aria-label="${esc(t('bu.remove'))}">×</button>
        </div>`).join('')}
      <button class="btn ghost sm" id="addIncome">${t('bu.addIncome')}</button>
    </div>

    <div class="card">
      <div class="row"><h3 class="m0">${t('bu.spendPlan')}</h3><span class="spacer"></span><b class="num">${rp(totalBudget)}</b><button class="btn sm" id="copyPrev">${t('bu.copy')}</button></div>
      ${st.categories.map((c) => {
        const open = ui.openCat === c.id;
        const edit = ui.editCat === c.id;
        return `<div class="bcat ${open ? 'open' : ''}" data-cat="${c.id}">
          <button class="bcat-h"><span class="dot" style="background:${colors[c.id]}"></span><b>${esc(c.name)}</b><span class="num muted">${rp(sumCat(c))}</span><span class="chev">${open ? '▾' : '▸'}</span></button>
          ${open ? `
            ${c.items.map((i) => `<div class="bitem" data-item="${i.id}">
              <span>${esc(i.name)}</span>
              <input class="num ni bud" inputmode="numeric" value="${fmtInput(m.budget[i.id])}" placeholder="0" aria-label="${esc(i.name)}">
              <span class="tg"><button class="tgl ifix ${i.fixed ? 'on' : ''}" aria-pressed="${!!i.fixed}" title="${esc(t('bu.fixedTip'))}">${t('bu.fixed')}</button><button class="tgl irec ${i.recurring ? 'on' : ''}" aria-pressed="${!!i.recurring}" title="${esc(t('bu.rutinTip'))}">${t('bu.rutin')}</button></span>
            </div>`).join('')}
            <div class="catset">
              <label>${t('bu.catName')}<input class="cname" value="${esc(c.name)}"></label>
              <label>${t('bu.type')}<select class="ctype">${types.map((k) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${t('type.' + k)}</option>`).join('')}</select></label>
              <label class="check full"><input type="checkbox" class="cgood" ${c.overIsGood ? 'checked' : ''}> ${t('bu.good')}</label>
              <div class="full row"><button class="btn sm editItems">${t('bu.itemsKw')} ${edit ? '▾' : '▸'}</button><span class="spacer"></span><button class="btn ghost sm danger delCat">${t('bu.delCat')}</button></div>
              ${edit ? `<div class="full items-edit">
                <p class="hint">${t('bu.kwHint')}</p>
                ${c.items.map((i) => `<div class="item-edit" data-item="${i.id}"><input class="iname2" value="${esc(i.name)}" aria-label="${esc(t('bu.itemName'))}"><input class="ikw" value="${esc((i.keywords || []).join(', '))}" placeholder="${esc(t('bu.kw'))}" aria-label="${esc(t('bu.kw'))}"><button class="btn ghost sm danger idel" aria-label="${esc(t('bu.delItemBtn'))}">×</button></div>`).join('')}
                <button class="btn ghost sm addItem">${t('bu.addItem')}</button>
              </div>` : ''}
            </div>` : ''}
        </div>`;
      }).join('')}
      <button class="btn ghost sm" id="addCat">${t('bu.addCat')}</button>
    </div>`;

  // simpan otomatis saat isian berubah
  const saveQuiet = () => { store.save(); toast(t('c.saved'), 1000); };
  const amountInput = (inp, set) => { inp.onchange = () => { set(parseAmount(inp.value)); inp.value = fmtInput(parseAmount(inp.value)); saveQuiet(); }; };
  amountInput($('#prevBal', el), (v) => (m.prevBalance = v));
  $$('.inc[data-id]', el).forEach((row) => {
    const x = m.income.find((i) => i.id === row.dataset.id);
    $('.iname', row).onchange = (e) => { x.name = e.target.value; saveQuiet(); };
    amountInput($('.iproj', row), (v) => (x.projected = v));
    amountInput($('.iact', row), (v) => (x.actual = v));
    $('.x', row).onclick = () => { m.income = m.income.filter((i) => i !== x); store.save(); renderBudget(); };
  });
  $('#addIncome', el).onclick = () => { m.income.push({ id: store.uid(), name: t('bu.extra'), projected: 0, actual: 0 }); store.save(); renderBudget(); };
  $('#copyPrev', el).onclick = () => {
    const prev = st.months[shiftMonth(ui.month, -1)];
    if (!prev) return toast(t('bu.noPrev'));
    if (!confirm(t('bu.copyConfirm'))) return;
    m.budget = { ...prev.budget }; store.save(); renderBudget(); toast(t('bu.copied'));
  };

  $$('.bcat', el).forEach((box) => {
    const c = st.categories.find((x) => x.id === box.dataset.cat);
    $('.bcat-h', box).onclick = () => { ui.openCat = ui.openCat === c.id ? null : c.id; ui.editCat = null; renderBudget(); };
    if (ui.openCat !== c.id) return;
    $$('.bitem', box).forEach((row) => {
      const it = c.items.find((i) => i.id === row.dataset.item);
      amountInput($('.bud', row), (v) => { if (v) m.budget[it.id] = v; else delete m.budget[it.id]; });
      $('.ifix', row).onclick = () => { it.fixed = !it.fixed; store.save(); renderBudget(); };
      $('.irec', row).onclick = () => { it.recurring = !it.recurring; store.save(); renderBudget(); };
    });
    $('.cname', box).onchange = (e) => { c.name = e.target.value.trim() || c.name; saveQuiet(); };
    $('.ctype', box).onchange = (e) => { c.type = e.target.value; saveQuiet(); };
    $('.cgood', box).onchange = (e) => { c.overIsGood = e.target.checked; saveQuiet(); };
    $('.editItems', box).onclick = () => { ui.editCat = ui.editCat === c.id ? null : c.id; renderBudget(); };
    $('.delCat', box).onclick = () => {
      if (st.transactions.some((x) => x.catId === c.id)) return toast(t('bu.catHasTx'));
      if (!confirm(t('bu.delCatQ', { n: c.name }))) return;
      st.categories = st.categories.filter((x) => x !== c); ui.openCat = null; store.save(); renderBudget();
    };
    $$('.item-edit', box).forEach((row) => {
      const it = c.items.find((i) => i.id === row.dataset.item);
      $('.iname2', row).onchange = (e) => { it.name = e.target.value.trim() || it.name; saveQuiet(); };
      $('.ikw', row).onchange = (e) => { it.keywords = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); saveQuiet(); };
      $('.idel', row).onclick = () => {
        if (st.transactions.some((x) => x.itemId === it.id)) return toast(t('bu.itemHasTx'));
        if (c.items.length === 1) return toast(t('bu.minOne'));
        if (!confirm(t('bu.delItem', { n: it.name }))) return;
        c.items = c.items.filter((i) => i !== it); store.save(); renderBudget();
      };
    });
    const add = $('.addItem', box);
    if (add) add.onclick = () => { c.items.push({ id: store.uid(), name: t('bu.newItem'), keywords: [] }); store.save(); renderBudget(); };
  });
  $('#addCat', el).onclick = () => {
    const name = prompt(t('bu.newCatPrompt'));
    if (!name) return;
    const id = store.uid();
    st.categories.push({ id, name: name.trim(), type: 'variable', items: [{ id: store.uid(), name: t('c.others'), keywords: [] }] });
    ui.openCat = id; store.save(); renderBudget();
  };
}

// ---------- pengaturan ----------
function renderSettings() {
  const el = $('#view-settings');
  const st = store.getState();
  const year = ui.month.slice(0, 4);
  const monthsWithData = Object.keys(st.months).sort();
  const age = backupAgeDays();
  const lastTxt = st.settings.lastBackupAt
    ? t('se.daysAgo', { d: fmtDate(st.settings.lastBackupAt, { day: 'numeric', month: 'short', year: 'numeric' }), n: age })
    : t('se.neverLower');

  el.innerHTML = `
    ${pageHead(t('nav.settings'), '')}
    <div class="card">
      <h3>${t('se.display')}</h3>
      <div class="grid2">
        <label>${t('se.lang')}<select id="langSel"><option value="en" ${getLang() === 'en' ? 'selected' : ''}>English</option><option value="id" ${getLang() === 'id' ? 'selected' : ''}>Bahasa Indonesia</option></select></label>
        <label>${t('se.numFmt')}<select id="numSel"><option value="dot" ${st.settings.numberFormat !== 'comma' ? 'selected' : ''}>${t('se.fmtDot')}</option><option value="comma" ${st.settings.numberFormat === 'comma' ? 'selected' : ''}>${t('se.fmtComma')}</option></select></label>
      </div>
    </div>

    <div class="card">
      <h3>${t('se.backup')}</h3>
      ${needsBackup() ? `<div class="banner warn"><div><b>${age === null ? t('se.never') : t('se.lastAgo', { n: age })}</b><br><small>${t('se.onlyHere')}</small></div></div>` : ''}
      <p class="hint">${t('se.last', { v: `<b>${esc(lastTxt)}</b>` })}</p>
      <div class="row"><button class="btn primary" id="shareBackup">${t('se.share')}</button></div>
      <div class="row">
        <button class="btn" id="backup">${t('se.download')}</button>
        <label class="btn file">${t('se.restore')}<input type="file" id="restore" accept=".txt,.json,text/plain,application/json" hidden></label>
      </div>
      <p class="hint">${t('se.backupHint', { m: monthsWithData.length ? monthsWithData.map(monthLabel).join(', ') : '–' })}</p>
    </div>

    <div class="card">
      <h3>${t('se.export')}</h3>
      <p class="hint">${t('se.exportHint')}</p>
      <div class="row">
        <button class="btn primary" data-exp="month">${esc(monthLabel(ui.month))}</button>
        <button class="btn" data-exp="year">${t('se.year', { y: year })}</button>
        <button class="btn" data-exp="all">${t('se.allMonths')}</button>
      </div>
    </div>

    <div class="card">
      <h3>${t('se.pin')}</h3>
      <label class="check"><input type="checkbox" id="pinOn" ${lock.isEnabled() ? 'checked' : ''}> ${t('se.pinOn')}</label>
      <label>${t('se.pinAfter')}
        <select id="pinAfter" ${lock.isEnabled() ? '' : 'disabled'}>
          ${[[90, t('se.s90')], [120, t('se.m2')], [300, t('se.m5')]].map(([v, txt]) => `<option value="${v}" ${lock.lockAfterSec() === v ? 'selected' : ''}>${txt}</option>`).join('')}
        </select>
      </label>
      ${lock.isEnabled() ? `<div class="row"><button class="btn" id="pinChange">${t('se.pinChange')}</button></div>` : ''}
      <p class="hint">${t('se.pinHint')}</p>
    </div>

    <div class="card">
      <h3>${t('se.ai')}</h3>
      <p class="hint">${t('se.aiHint')}</p>
      <div class="grid2">
        <label>${t('se.apiKey')}<input id="apiKey" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(st.settings.apiKey)}"></label>
        <label>${t('se.aiWhen')}
          <select id="aiMode">
            <option value="unknown" ${st.settings.aiMode !== 'auto' ? 'selected' : ''}>${t('se.aiBtn')}</option>
            <option value="auto" ${st.settings.aiMode === 'auto' ? 'selected' : ''}>${t('se.aiAuto')}</option>
          </select>
        </label>
      </div>
    </div>

    <div class="card">
      <h3>${t('se.reading')}</h3>
      <label class="check"><input type="checkbox" id="smallK" ${st.settings.smallNumberThousands ? 'checked' : ''}> ${t('se.smallK', { k: groupDigits('1000'), v: rp(35000) })}</label>
      <div class="row"><span class="hint m0">${t('se.learned', { n: Object.keys(st.learned).length })}</span><button class="btn ghost sm" id="clearLearned">${t('se.clearLearned')}</button></div>
    </div>

    <div class="card version">
      <h3>${t('se.about')}</h3>
      <div class="row"><b>${t('se.version', { v: APP_VERSION })}</b><span class="spacer"></span><button class="btn sm" id="checkUpdate">${t('se.check')}</button></div>
      <div class="row danger-zone"><span class="spacer"></span><button class="btn ghost sm danger" id="reset">${t('se.reset')}</button></div>
    </div>`;

  $('#checkUpdate', el).onclick = checkForUpdate;
  $('#langSel', el).onchange = (e) => { st.settings.lang = e.target.value; store.save(); applyPrefs(); applyStaticText(); render(); };
  $('#numSel', el).onchange = (e) => { st.settings.numberFormat = e.target.value; store.save(); applyPrefs(); render(); };
  $$('[data-exp]', el).forEach((b) => (b.onclick = async () => {
    const all = Object.keys(st.months);
    const keys = b.dataset.exp === 'month' ? [ui.month] : b.dataset.exp === 'year' ? all.filter((k) => k.startsWith(year)) : all;
    if (!keys.length) return toast(t('se.noData'));
    b.disabled = true;
    try { const r = await exportExcel(keys); if (r !== 'cancelled') toast(r === 'shared' ? t('se.xShared') : t('se.xDl')); } catch (e) { toast(t('se.xFail', { e: e.message })); }
    b.disabled = false;
  }));
  $('#apiKey', el).onchange = (e) => { st.settings.apiKey = e.target.value.trim(); store.save(); toast(t('se.keySaved')); };
  $('#aiMode', el).onchange = (e) => { st.settings.aiMode = e.target.value; store.save(); };
  $('#smallK', el).onchange = (e) => { st.settings.smallNumberThousands = e.target.checked; store.save(); };
  $('#pinOn', el).onchange = async (e) => {
    const want = e.target.checked;
    const ok = want ? await lock.enableFlow() : await lock.disableFlow();
    toast(ok ? (want ? t('se.pinOnT') : t('se.pinOffT')) : t('c.cancelled'));
    renderSettings();
  };
  $('#pinAfter', el).onchange = (e) => { lock.setLockAfter(Number(e.target.value)); toast(t('c.saved')); };
  const pc = $('#pinChange', el);
  if (pc) pc.onclick = async () => { toast((await lock.changeFlow()) ? t('se.pinChanged') : t('c.cancelled')); };
  $('#clearLearned', el).onclick = () => { if (confirm(t('se.clearLearnedQ'))) { st.learned = {}; store.save(); renderSettings(); } };
  $('#backup', el).onclick = () => { downloadBackup(); renderSettings(); };
  $('#shareBackup', el).onclick = shareBackup;
  $('#restore', el).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm(t('se.restoreQ'))) return;
    try {
      const prefs = { ...store.getState().settings };
      store.importJSON(await file.text());
      const s = store.getState().settings;
      if (!s.apiKey) s.apiKey = prefs.apiKey;
      // Bahasa & format angka mengikuti perangkat ini, bukan file backup.
      s.lang = prefs.lang; s.numberFormat = prefs.numberFormat;
      store.save(); applyPrefs();
      toast(t('se.restored')); render();
    } catch (err) { toast(t('se.failed', { e: err.message })); }
  };
  $('#reset', el).onclick = () => {
    if (!confirm(t('se.resetQ'))) return;
    const prefs = { ...store.getState().settings };
    store.resetAll();
    Object.assign(store.getState().settings, { lang: prefs.lang, numberFormat: prefs.numberFormat });
    store.save();
    toast(t('se.erased')); render();
  };
}

// ---------- cek pembaruan ----------
async function checkForUpdate(e) {
  const btn = e?.currentTarget;
  if (btn) { btn.disabled = true; btn.textContent = t('se.checking'); }
  try {
    const src = await (await fetch(`js/version.js?t=${Date.now()}`, { cache: 'no-store' })).text();
    const latest = (src.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
    if (!latest) throw new Error('no version');
    if (latest === APP_VERSION) {
      toast(t('se.upToDate', { v: APP_VERSION }));
    } else {
      toast(t('se.updating', { v: latest }), 4000);
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update().catch(() => {});
      setTimeout(() => location.reload(), 1200);
      return;
    }
  } catch {
    toast(t('se.checkFail'));
  }
  if (btn) { btn.disabled = false; btn.textContent = t('se.check'); }
}

// ---------- init ----------
$('#prevMonth').onclick = () => setMonth(shiftMonth(ui.month, -1));
$('#nextMonth').onclick = () => setMonth(shiftMonth(ui.month, 1));
$('#monthPicker').onchange = (e) => e.target.value && setMonth(e.target.value);
$$('.bottomnav button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));

store.ensureMonth(ui.month);
applyStaticText();

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
  if (!confirm(t('lk.forgotQ1'))) return;
  if (!confirm(t('lk.forgotQ2'))) return;
  store.resetAll();
  lock.clearLock();
  location.reload();
}
lock.initAutoLock(forgotPin);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
