// Kunci aplikasi dengan PIN 6 digit.
// Ini layar privasi (melindungi dari orang yang memegang tablet), bukan enkripsi data.
// PIN tidak disimpan; yang disimpan hanya hash PBKDF2 + salt acak, di kunci localStorage terpisah
// sehingga tidak ikut file backup dan tidak tertimpa saat Restore.

const KEY = 'catfin.lock';
const PIN_LEN = 6;
const MAX_TRIES = 3;
const PENALTY_MS = 5 * 60 * 1000;
const ITER = 150000;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPin(pin, saltB64) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: ITER }, key, 256);
  return b64(bits);
}

export const isEnabled = () => !!read().hash;
export const lockAfterSec = () => read().after ?? 120;
export function setLockAfter(sec) { const v = read(); v.after = sec; write(v); }
export function clearLock() { try { localStorage.removeItem(KEY); } catch {} }

async function verify(pin) {
  const v = read();
  return v.hash && (await hashPin(pin, v.salt)) === v.hash;
}
async function savePin(pin) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const v = read();
  Object.assign(v, { salt, hash: await hashPin(pin, salt), fails: 0, until: 0 });
  write(v);
}
export function disable() { const v = read(); delete v.hash; delete v.salt; v.fails = 0; v.until = 0; write(v); }

// ---------- overlay ----------
let overlay = null;

function build() {
  overlay = document.createElement('div');
  overlay.className = 'lock';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="lock-box">
      <div class="lock-ico">🔒</div>
      <h2 class="lock-title"></h2>
      <p class="lock-msg" aria-live="polite"></p>
      <div class="lock-dots">${'<i></i>'.repeat(PIN_LEN)}</div>
      <div class="lock-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" class="lock-alt" data-k="cancel"></button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="del" aria-label="Hapus">⌫</button>
      </div>
      <button type="button" class="lock-forgot">Lupa PIN?</button>
    </div>`;
  document.body.appendChild(overlay);
}

/**
 * Tampilkan layar PIN.
 * mode: 'unlock' | 'verify' (konfirmasi PIN lama, bisa dibatalkan) | 'set' (buat PIN baru + ulangi)
 * @returns {Promise<string|null>} PIN yang dimasukkan, atau null bila dibatalkan
 */
function prompt(mode, { title, onForgot } = {}) {
  if (!overlay) build();
  document.body.classList.add('locked');
  overlay.hidden = false;
  const $ = (s) => overlay.querySelector(s);
  const dots = [...overlay.querySelectorAll('.lock-dots i')];
  let buf = '';
  let first = null;
  let timer = null;

  const setTitle = () => { $('.lock-title').textContent = mode === 'set' ? (first ? 'Ulangi PIN baru' : (title || 'Buat PIN 6 digit')) : (title || 'Masukkan PIN'); };
  const draw = () => dots.forEach((d, i) => d.classList.toggle('on', i < buf.length));
  const msg = (t, bad) => { const m = $('.lock-msg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); };
  const cancelBtn = $('.lock-alt');
  cancelBtn.textContent = mode === 'unlock' ? '' : 'Batal';
  cancelBtn.disabled = mode === 'unlock';
  $('.lock-forgot').hidden = mode !== 'unlock';
  setTitle(); draw(); msg('');

  const penaltyLeft = () => Math.max(0, (read().until || 0) - Date.now());
  const showPenalty = () => {
    clearInterval(timer);
    const tick = () => {
      const left = penaltyLeft();
      if (!left) { clearInterval(timer); msg(''); return; }
      const total = Math.ceil(left / 1000);
      msg(`PIN salah ${MAX_TRIES} kali. Coba lagi dalam ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`, true);
    };
    tick(); timer = setInterval(tick, 1000);
  };
  if (mode !== 'set' && penaltyLeft()) showPenalty();

  return new Promise((resolve) => {
    const finish = (val) => {
      clearInterval(timer);
      overlay.hidden = true;
      document.body.classList.remove('locked');
      overlay.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const submit = async () => {
      const pin = buf;
      buf = ''; draw();
      if (mode === 'set') {
        if (!first) { first = pin; setTitle(); msg(''); return; }
        if (pin !== first) { first = null; setTitle(); msg('PIN tidak sama. Ulangi dari awal.', true); return; }
        return finish(pin);
      }
      if (penaltyLeft()) return showPenalty();
      if (await verify(pin)) {
        const v = read(); v.fails = 0; v.until = 0; write(v);
        return finish(pin);
      }
      const v = read();
      v.fails = (v.fails || 0) + 1;
      if (v.fails >= MAX_TRIES) { v.fails = 0; v.until = Date.now() + PENALTY_MS; write(v); return showPenalty(); }
      write(v);
      msg(`PIN salah. Sisa ${MAX_TRIES - v.fails} kali percobaan.`, true);
    };
    const press = (k) => {
      if (k === 'cancel') { if (mode !== 'unlock') finish(null); return; }
      if (k === 'del') { buf = buf.slice(0, -1); draw(); return; }
      if (mode !== 'set' && penaltyLeft()) return;
      if (buf.length >= PIN_LEN) return;
      buf += k; draw();
      if (buf.length === PIN_LEN) setTimeout(submit, 120);
    };
    function onKey(e) {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape') press('cancel');
      else return;
      e.preventDefault(); e.stopPropagation();
    }
    document.addEventListener('keydown', onKey, true);
    overlay.onclick = (e) => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k) press(k);
      if (e.target.closest('.lock-forgot') && onForgot) onForgot();
    };
  });
}

let unlocking = false;
export async function lockNow(onForgot) {
  if (!isEnabled() || unlocking) return;
  unlocking = true;
  await prompt('unlock', { onForgot });
  unlocking = false;
}

/** Minta PIN saat dibuka, lalu kunci lagi bila aplikasi ditinggal lebih lama dari batas waktu. */
export function initAutoLock(onForgot) {
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (!isEnabled()) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      document.body.classList.add('privacy'); // sembunyikan isi di daftar aplikasi terbuka
    } else {
      document.body.classList.remove('privacy');
      if (hiddenAt && Date.now() - hiddenAt >= lockAfterSec() * 1000) lockNow(onForgot);
      hiddenAt = null;
    }
  });
  return lockNow(onForgot);
}

/** Aktifkan PIN (buat baru). */
export async function enableFlow() {
  const pin = await prompt('set');
  if (!pin) return false;
  await savePin(pin);
  return true;
}
/** Matikan PIN (harus memasukkan PIN lama). */
export async function disableFlow() {
  const ok = await prompt('verify', { title: 'Masukkan PIN saat ini' });
  if (!ok) return false;
  disable();
  return true;
}
/** Ganti PIN. */
export async function changeFlow() {
  const ok = await prompt('verify', { title: 'Masukkan PIN lama' });
  if (!ok) return false;
  const pin = await prompt('set', { title: 'Buat PIN baru' });
  if (!pin) return false;
  await savePin(pin);
  return true;
}
