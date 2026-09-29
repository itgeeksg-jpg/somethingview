// SomethingView backend — a free Cloudflare Worker that:
//   1. /?url=...   proxies Yahoo Finance so the browser can read it (Yahoo has no CORS)
//   2. /sync/<key> stores the app's watchlists/indicators/drawings so every device stays in sync
//
// Deploy: cd worker && npx wrangler deploy   (see wrangler.toml for the D1 database binding)
//
// The proxy only allows Yahoo Finance hosts, so it is not an open proxy.
// Sync data is stored under the SHA-256 of a random 128-bit key that only your devices know.

const ALLOWED_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const ALLOWED_ORIGIN = '*'; // e.g. 'https://itgeeksg-jpg.github.io' to restrict
const MAX_SYNC_BYTES = 2_000_000;

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleSync(request, env, key) {
  if (!/^[a-f0-9]{32}$/.test(key)) return json({ error: 'bad key' }, 400);
  if (!env.DB) return json({ error: 'sync storage not configured' }, 500);
  const id = await sha256(key);
  const row = await env.DB.prepare('SELECT data, updated FROM state WHERE id = ?').bind(id).first();

  if (request.method === 'GET') {
    if (!row) return json({ error: 'not found' }, 404);
    return json({ updated: row.updated, data: JSON.parse(row.data) });
  }
  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > MAX_SYNC_BYTES) return json({ error: 'too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    const updated = Number(body.updated) || 0;
    // Last writer wins, but never let an older copy overwrite a newer one
    if (row && row.updated > updated) return json({ updated: row.updated, data: JSON.parse(row.data) }, 409);
    await env.DB.prepare('INSERT INTO state (id, data, updated) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = ?2, updated = ?3')
      .bind(id, JSON.stringify(body.data ?? {}), updated).run();
    return json({ updated });
  }
  return json({ error: 'method not allowed' }, 405);
}

async function handleProxy(request, ctx) {
  const target = new URL(request.url).searchParams.get('url');
  let url;
  try { url = new URL(target); } catch { return new Response('Missing or invalid ?url=', { status: 400, headers: cors }); }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
    return new Response('Host not allowed', { status: 403, headers: cors });
  }

  // Short edge cache keeps many open tabs/devices from hammering Yahoo
  const cache = caches.default;
  const cacheKey = new Request(url.toString());
  let res = await cache.match(cacheKey);
  if (!res) {
    const upstream = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
      },
    });
    res = new Response(upstream.body, upstream);
    res.headers.set('Cache-Control', `public, max-age=${url.pathname.includes('/search') ? 300 : 10}`);
    if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const path = new URL(request.url).pathname;
    if (path.startsWith('/sync/')) return handleSync(request, env, path.slice(6));
    return handleProxy(request, ctx);
  },
};
