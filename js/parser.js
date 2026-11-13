// Parser catatan: mengubah teks bebas (satu item per baris) menjadi daftar transaksi.
// Modul murni tanpa akses DOM / storage supaya bisa dites dengan Node.

const MONTHS_ID = {
  jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, nov: 11, november: 11,
  des: 12, dec: 12, desember: 12,
};

// Angka + satuan opsional. Contoh: 35000, 35.000, 35,000, 35rb, 35 ribu, 35k, 1,5jt, 1.5 juta, Rp 35.000
const AMOUNT_RE = /(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta)?(?![\w])/gi;

const pad = (n) => String(n).padStart(2, '0');

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ubah token angka + satuan menjadi rupiah.
 * @param {string} num  bagian angka, mis. "35.000" atau "1,5"
 * @param {string} unit satuan, mis. "rb", "jt"
 * @param {object} opts { smallNumberThousands }
 * @returns {{value:number, assumed:boolean}}
 */
export function toRupiah(num, unit, opts = {}) {
  const u = (unit || '').toLowerCase();
  const grouped = /^\d{1,3}([.,]\d{3})+$/.test(num);
  let base;
  if (grouped) {
    base = Number(num.replace(/[.,]/g, ''));
  } else if (/^\d{1,3}([.,]\d{3})+[.,]\d{1,2}$/.test(num)) {
    // 35.000,50 -> buang sen
    base = Number(num.replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, ''));
  } else {
    base = Number(num.replace(',', '.'));
  }
  if (!Number.isFinite(base)) return { value: NaN, assumed: false };
  let mult = 1;
  if (u === 'rb' || u === 'ribu' || u === 'k') mult = 1e3;
  else if (u === 'jt' || u === 'juta') mult = 1e6;
  let assumed = false;
  if (!u && !grouped && base > 0 && base < 1000 && opts.smallNumberThousands !== false) {
    // "kopi 35" biasanya berarti 35 ribu
    mult = 1e3;
    assumed = true;
  }
  return { value: Math.round(base * mult), assumed };
}

/** Cari tanggal di awal baris. Mengembalikan {date:'YYYY-MM-DD', rest} atau null. */
export function extractLeadingDate(line, refYear) {
  const s = line.trim();
  // 12/11, 12-11, 12/11/26, 12/11/2026
  let m = s.match(/^(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?(?=\s|$|[:.,-])\s*[:.,-]?\s*/);
  if (m) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : refYear;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return { date: `${y}-${pad(mo)}-${pad(d)}`, rest: s.slice(m[0].length) };
    }
  }
  // "12 nov", "12 november 2026", opsional diawali nama hari
  m = s.match(/^(?:(?:senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|ahad)\s*,?\s*)?(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?(?=\s|$|[:.,-])\s*[:.,-]?\s*/i);
  if (m && MONTHS_ID[m[2].toLowerCase()]) {
    const d = +m[1], mo = MONTHS_ID[m[2].toLowerCase()];
    const y = m[3] ? +m[3] : refYear;
    if (d >= 1 && d <= 31) return { date: `${y}-${pad(mo)}-${pad(d)}`, rest: s.slice(m[0].length) };
  }
  return null;
}

function cleanDesc(s) {
  return s
    .replace(/\brp\.?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:=\-–—.,+*•]+|[\s:=\-–—.,*•@]+$/g, '')
    .trim();
}

/** Pecah satu baris menjadi beberapa segmen jika ada pemisah "; " atau ", " dan tiap segmen punya angka. */
function splitSegments(line) {
  const parts = line.split(/;\s*|,\s+(?=\D)/);
  if (parts.length > 1 && parts.every((p) => /\d/.test(p))) return parts;
  return [line];
}

/** Parse satu segmen "item jumlah". */
function parseSegment(seg, opts) {
  const matches = [...seg.matchAll(AMOUNT_RE)];
  if (!matches.length) return null;
  // Ambil angka terakhir yang wajar (item bisa mengandung angka, mis. "aqua 2 galon 40rb")
  let pick = null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const r = toRupiah(m[1], m[2], opts);
    if (r.value > 0) { pick = { m, r }; break; }
  }
  if (!pick) return null;
  const { m, r } = pick;
  const desc = cleanDesc(seg.slice(0, m.index) + ' ' + seg.slice(m.index + m[0].length));
  return { desc, amount: r.value, assumedThousands: r.assumed };
}

/**
 * Parse catatan lengkap.
 * - Satu item per baris: "Kopi 35000", "Bensin 150rb", "Listrik 503.000"
 * - Tanggal opsional di awal baris ("12/11 kopi 35k") atau sebagai judul baris ("12 Nov")
 * - Baris diawali "+" dianggap pemasukan
 * @returns {{entries: Array, skipped: Array<string>}}
 */
export function parseNotes(text, opts = {}) {
  const refYear = opts.refYear || new Date().getFullYear();
  const entries = [];
  const skipped = [];
  let currentDate = opts.defaultDate || null;

  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    let line = raw.replace(/^\s*(?:[-*•▪◦·]|\d{1,2}[.)](?=\s))\s*/, '').trim();
    if (!line) continue;

    let date = null;
    const d = extractLeadingDate(line, refYear);
    if (d) {
      if (!d.rest.trim()) { currentDate = d.date; continue; } // baris judul tanggal
      date = d.date;
      line = d.rest;
    }

    let isIncome = false;
    if (/^\+/.test(line)) { isIncome = true; line = line.replace(/^\+\s*/, ''); }

    for (const seg of splitSegments(line)) {
      const p = parseSegment(seg, opts);
      if (!p || !p.desc) { skipped.push(raw.trim()); continue; }
      entries.push({
        desc: p.desc,
        amount: p.amount,
        date: date || currentDate,
        isIncome,
        assumedThousands: p.assumedThousands,
        raw: raw.trim(),
      });
    }
  }
  return { entries, skipped };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tentukan kategori untuk deskripsi.
 * Urutan: (1) pernah dikoreksi persis sama, (2) bagian dari koreksi sebelumnya, (3) kata kunci terpanjang.
 * @param {string} desc
 * @param {Array} categories
 * @param {Object} learned  { "kopi kenangan": {catId, itemId} }
 * @returns {{catId, itemId, source:'learned'|'keyword'|'none', keyword?}}
 */
export function categorize(desc, categories, learned = {}) {
  const norm = normalizeText(desc);
  if (!norm) return { catId: null, itemId: null, source: 'none' };
  const valid = (hit) => {
    const c = categories.find((x) => x.id === hit.catId);
    return c && c.items.some((i) => i.id === hit.itemId);
  };

  if (learned[norm] && valid(learned[norm])) return { ...learned[norm], source: 'learned' };

  let best = null;
  for (const [key, hit] of Object.entries(learned)) {
    if (key.length < 3 || !valid(hit)) continue;
    if (new RegExp(`(^|\\s)${escapeRe(key)}(\\s|$)`).test(norm)) {
      if (!best || key.length > best.len) best = { ...hit, len: key.length, keyword: key };
    }
  }
  if (best) return { catId: best.catId, itemId: best.itemId, source: 'learned', keyword: best.keyword };

  for (const c of categories) {
    for (const it of c.items) {
      for (const kw of it.keywords || []) {
        const k = normalizeText(kw);
        if (!k) continue;
        if (new RegExp(`(^|\\s)${escapeRe(k)}(\\s|$)`).test(norm)) {
          if (!best || k.length > best.len) best = { catId: c.id, itemId: it.id, len: k.length, keyword: k };
        }
      }
    }
  }
  if (best) return { catId: best.catId, itemId: best.itemId, source: 'keyword', keyword: best.keyword };
  return { catId: null, itemId: null, source: 'none' };
}

export function formatRp(n, { sign = false } = {}) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toLocaleString('id-ID');
  if (v < 0) return `-Rp${s}`;
  return `${sign && v > 0 ? '+' : ''}Rp${s}`;
}
