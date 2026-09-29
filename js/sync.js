// Optional cloud sync of watchlists/layout via a private GitHub Gist,
// so the same lists show up on every device that opens the site.
import { store } from './store.js';
import { debounce, toast } from './util.js';

const FILE = 'somethingview.json';
const API = 'https://api.github.com';

function headers() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${store.s.settings.gistToken.trim()}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function gh(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { ...headers(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`GitHub ${res.status}: ${j.message || res.statusText}`);
  }
  return res.json();
}

export const syncEnabled = () => !!store.s.settings.gistToken.trim();

// Find an existing sync gist (so a second device only needs the token)
async function findGist() {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const g = list.find(x => x.files?.[FILE]);
    if (g) return g.id;
    if (list.length < 100) break;
  }
  return null;
}

async function ensureGist(create) {
  if (store.s.settings.gistId) return store.s.settings.gistId;
  let id = await findGist();
  if (!id && create) {
    const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: 'SomethingView watchlists & layout', public: false, files: { [FILE]: { content: JSON.stringify(store.exportData()) } } }) });
    id = g.id;
  }
  if (id) { store.s.settings.gistId = id; store.save(false); }
  return id;
}

export async function push() {
  const id = await ensureGist(true);
  await gh(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(store.exportData()) } } }) });
  lastPushed = store.s.updated;
  return id;
}

// Returns true when remote data was newer and got applied
export async function pull({ force = false } = {}) {
  const id = await ensureGist(false);
  if (!id) return false;
  const g = await gh(`/gists/${id}`);
  const f = g.files?.[FILE];
  if (!f) return false;
  let text = f.content;
  if (f.truncated) text = await (await fetch(f.raw_url)).text();
  const data = JSON.parse(text);
  if (!force && (data.updated || 0) <= (store.s.updated || 0)) return false;
  store.importData(data);
  lastPushed = store.s.updated;
  return true;
}

let lastPushed = 0;
let status = () => {};
export function onStatus(fn) { status = fn; }

const autoPush = debounce(async () => {
  if (!syncEnabled() || !store.s.settings.autoSync || store.s.updated === lastPushed) return;
  status('syncing');
  try { await push(); status('ok'); } catch (e) { status('error', e.message); }
}, 4000);

export function startAutoSync() {
  store.on('changed', autoPush);
  // Pick up changes made on other devices when coming back to this tab
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !syncEnabled() || !store.s.settings.autoSync) return;
    try {
      if (await pull()) { toast('Synced newer data from another device', 'ok'); location.reload(); }
    } catch { /* offline */ }
  });
}
