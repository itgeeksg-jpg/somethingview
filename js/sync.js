// Automatic sync of watchlists, indicators, drawings and chart layout across devices.
// Every device signed in with the same login shares one copy, stored by the SomethingView
// Cloudflare Worker (worker/index.js, /api/sync/me).
import { store } from './store.js';
import { DEFAULT_PROXY } from './data.js';
import { debounce, withTimeout } from './util.js';

// Shared across devices, like TradingView: lists, indicators, drawings…
const SYNCED = ['lists', 'listOrder', 'collapsed', 'drawings', 'indicators', 'indicatorDefaults', 'favIntervals'];
// …and the chart layout. Layout from another device is applied when this app is opened or switched
// back to, never while you're looking at it (so a chart doesn't jump under you).
const LAYOUT = ['symbol', 'interval', 'chartType', 'logScale', 'activeList'];
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj?.[k] !== undefined).map(k => [k, obj[k]]));
const API = `${new URL(DEFAULT_PROXY).origin}/api/sync/me`;

let lastJson = null;
let pendingLayout = null;
let remoteHandler = () => {};
let statusHandler = () => {};
let lastStatus = ['idle', ''];
let lastSyncedAt = null;

export const onRemote = fn => { remoteHandler = fn; };
export const onStatus = fn => { statusHandler = fn; fn(...lastStatus); };
export const lastSynced = () => lastSyncedAt;
const setStatus = (st, msg = '') => {
  if (st === 'ok') lastSyncedAt = new Date();
  lastStatus = [st, msg];
  statusHandler(st, msg);
};
const payload = () => pick(store.s, [...SYNCED, ...LAYOUT]);

async function req(method, body) {
  const t = withTimeout(15000);
  try {
    const res = await fetch(API, {
      method, cache: 'no-store', signal: t.signal,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) location.reload(); // session expired: show login
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    t.done();
  }
}

function finishApply() {
  if (!store.s.lists[store.s.activeList]) store.s.activeList = store.s.listOrder[0];
  lastJson = JSON.stringify(payload());
  store.save(false);
  store.flush();
  remoteHandler();
}

function apply(data, updated, withLayout) {
  Object.assign(store.s, pick(data, SYNCED));
  const layout = pick(data, LAYOUT);
  if (withLayout) { Object.assign(store.s, layout); pendingLayout = null; } else pendingLayout = layout;
  store.s.syncUpdated = updated;
  finishApply();
}

// Returns true if newer data from another device was applied, 'missing' if nothing is stored yet.
// layout: also take over the other device's chart layout (on open / when switching back to the app)
// force: take the account's copy even if this device's looks newer (first sync on a device)
export async function pull({ layout = false, force = false } = {}) {
  const r = await req('GET');
  if (r.status === 404) return 'missing';
  if (r.status !== 200 || !r.json) throw new Error(`sync server error ${r.status}`);
  if (force || (r.json.updated || 0) > (store.s.syncUpdated || 0)) {
    apply(r.json.data, r.json.updated, layout);
    return true;
  }
  if (layout && pendingLayout) {
    // Received earlier while this app was on screen; apply it now
    Object.assign(store.s, pendingLayout);
    pendingLayout = null;
    finishApply();
    return true;
  }
  return false;
}

export async function push() {
  const r = await req('PUT', { updated: store.s.syncUpdated || Date.now(), data: payload() });
  if (r.status === 409 && r.json) { apply(r.json.data, r.json.updated, false); return; } // another device was newer
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

async function pullQuietly(opts) {
  try { await pull(opts); setStatus('ok'); } catch (e) { setStatus('error', e.message); }
}

// Call once at startup (before the UI is built, so the first render already shows synced data)
let started = false;
export async function start() {
  if (started) return;
  started = true;
  lastJson = JSON.stringify(payload());
  store.on('changed', onChanged);
  setInterval(() => { if (!document.hidden) pullQuietly(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pullQuietly({ layout: true }); });
  setStatus('syncing');
  try {
    // A device joining the account for the first time takes the account's lists as they are
    const first = !store.s.accountSynced;
    const r = await pull({ layout: true, force: first });
    if (r === 'missing' && !store.s.syncUpdated) store.s.syncUpdated = Date.now();
    // Nothing newer on the server: make sure it has this device's latest (e.g. after a reset or import)
    if (r !== true) await push();
    if (first) { store.s.accountSynced = true; store.save(false); }
    setStatus('ok');
  } catch (e) {
    setStatus('error', e.message);
  }
}

export async function syncNow() {
  setStatus('syncing');
  try {
    const got = await pull({ layout: true });
    if (got !== true) await push();
    setStatus('ok');
  } catch (e) {
    setStatus('error', e.message);
    throw e;
  }
}
