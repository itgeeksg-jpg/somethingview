// Automatic sync of watchlists, indicators and drawings across devices, stored by the
// SomethingView Cloudflare Worker (worker/cors-proxy.js, /sync/<key>).
// Each device holds a random sync key; devices sharing a key share data. Link a device by
// opening the "#sync=<key>" link (or QR code) from Settings → Sync devices.
import { store } from './store.js';
import { DEFAULT_PROXY } from './data.js';
import { debounce, withTimeout } from './util.js';

// Shared across devices. Everything else (current symbol, timeframe, active list, layout) stays per device.
const SYNCED = ['lists', 'listOrder', 'collapsed', 'drawings', 'indicators', 'indicatorDefaults', 'favIntervals'];
const ORIGIN = new URL(DEFAULT_PROXY).origin;
const API = `${ORIGIN}/sync/`;

let lastJson = null;
let remoteHandler = () => {};
let statusHandler = () => {};
let lastStatus = ['idle', ''];

export const onRemote = fn => { remoteHandler = fn; };
export const onStatus = fn => { statusHandler = fn; fn(...lastStatus); };
const setStatus = (st, msg = '') => { lastStatus = [st, msg]; statusHandler(st, msg); };

export const syncKey = () => store.s.settings.syncKey || '';
export const shareLink = () => `${location.origin}${location.pathname}#sync=${syncKey()}`;
const newKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const payload = () => Object.fromEntries(SYNCED.map(k => [k, store.s[k]]));

async function req(method, body) {
  const t = withTimeout(15000);
  try {
    const res = await fetch(API + syncKey(), {
      method, cache: 'no-store', signal: t.signal,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    t.done();
  }
}

function apply(data, updated) {
  for (const k of SYNCED) if (data?.[k] !== undefined) store.s[k] = data[k];
  if (!store.s.lists[store.s.activeList]) store.s.activeList = store.s.listOrder[0];
  store.s.syncUpdated = updated;
  lastJson = JSON.stringify(payload());
  store.save(false);
  store.flush();
  remoteHandler();
}

// Returns true if newer data from another device was applied, 'missing' if nothing is stored yet
export async function pull() {
  if (!syncKey()) return false;
  const r = await req('GET');
  if (r.status === 404) return 'missing';
  if (r.status !== 200 || !r.json) throw new Error(`sync server error ${r.status}`);
  if ((r.json.updated || 0) > (store.s.syncUpdated || 0)) {
    apply(r.json.data, r.json.updated);
    return true;
  }
  return false;
}

export async function push() {
  const r = await req('PUT', { updated: store.s.syncUpdated || Date.now(), data: payload() });
  if (r.status === 409 && r.json) { apply(r.json.data, r.json.updated); return; } // another device was newer
  if (r.status !== 200) throw new Error(r.json?.error || `sync server error ${r.status}`);
}

const pushSoon = debounce(async () => {
  setStatus('syncing');
  try { await push(); setStatus('ok'); } catch (e) { setStatus('error', e.message); }
}, 1500);

function onChanged() {
  const j = JSON.stringify(payload());
  if (j === lastJson) return;
  lastJson = j;
  store.s.syncUpdated = Date.now();
  store.save(false);
  pushSoon();
}

async function pullQuietly() {
  try { await pull(); setStatus('ok'); } catch (e) { setStatus('error', e.message); }
}

// Call once at startup (before the UI is built, so the first render already shows synced data)
let started = false;
export async function start() {
  if (started) return;
  started = true;
  if (!syncKey()) { store.s.settings.syncKey = newKey(); store.save(false); }
  lastJson = JSON.stringify(payload());
  store.on('changed', onChanged);
  setInterval(() => { if (!document.hidden) pullQuietly(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pullQuietly(); });
  setStatus('syncing');
  try {
    const r = await pull();
    if (r === 'missing') {
      if (!store.s.syncUpdated) store.s.syncUpdated = Date.now();
      await push();
    }
    setStatus('ok');
  } catch (e) {
    setStatus('error', e.message);
  }
}

// Short, human-typeable code for linking another device (valid 10 minutes, single use)
export async function createPairCode() {
  const res = await fetch(`${ORIGIN}/pair`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: syncKey() }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.code) throw new Error(j.error || `pairing error ${res.status}`);
  return j;
}

// Short fingerprint of the sync key, to check two devices are linked (safe to show)
export async function syncId() {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(syncKey()));
  return [...new Uint8Array(buf)].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function keyFrom(input) {
  const s = String(input).trim();
  const m = s.match(/[a-f0-9]{32}/i);
  if (m) return m[0].toLowerCase();
  const code = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw new Error('Enter the 6-character pairing code shown on your other device');
  const res = await fetch(`${ORIGIN}/pair/${code}`, { cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.key) throw new Error(j.error || 'Code not found or expired');
  return j.key;
}

// Link this device to another device's data (replaces this device's lists).
// Accepts a pairing code, a sync link or a raw key.
export async function join(input) {
  const key = await keyFrom(input);
  if (key === syncKey()) return false;
  const prev = { key: syncKey(), updated: store.s.syncUpdated };
  store.s.settings.syncKey = key;
  store.s.syncUpdated = 0;
  store.save(false);
  try {
    const r = await pull();
    if (r === 'missing') throw new Error('No synced data found for that code');
    setStatus('ok');
    return true;
  } catch (e) {
    store.s.settings.syncKey = prev.key;
    store.s.syncUpdated = prev.updated;
    store.save(false);
    throw e;
  }
}

export async function syncNow() {
  setStatus('syncing');
  try {
    const got = await pull();
    if (got !== true) await push();
    setStatus('ok');
  } catch (e) {
    setStatus('error', e.message);
    throw e;
  }
}
