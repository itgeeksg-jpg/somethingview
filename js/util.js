export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// Tiny element builder: h('div', {class: 'x', onclick}, child, 'text')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtPrice(v, precision = 2) {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

// Adaptive precision for indicator values and quotes with unknown tick size
export function autoPrecision(v) {
  const a = Math.abs(v);
  if (!isFinite(a) || a === 0) return 2;
  if (a >= 1000) return 2;
  if (a >= 10) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  return Math.min(10, Math.max(6, Math.ceil(-Math.log10(a)) + 3));
}

export function fmtAuto(v) {
  if (v == null || !isFinite(v)) return '—';
  return fmtPrice(v, autoPrecision(v));
}

export function fmtVol(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  const u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [d, s] of u) if (a >= d) return (v / d).toFixed(2).replace(/\.?0+$/, '') + ' ' + s;
  return v.toFixed(a < 10 ? 2 : 0);
}

export function fmtPct(v) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
}

export function fmtSigned(v, precision) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtPrice(Math.abs(v), precision);
}

export const upDownClass = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function toast(msg, type = 'info', ms = 3500) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = h('div', { class: `toast ${type}` }, msg);
  root.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export function download(filename, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// Stable pleasant color from a string (for symbol avatars)
export function hashColor(s) {
  let x = 0;
  for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(x) % 360} 55% 45%)`;
}
