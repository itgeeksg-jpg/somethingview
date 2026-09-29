// SomethingView data proxy — a free Cloudflare Worker that lets the browser read Yahoo Finance.
//
// Deploy (free plan is plenty: 100k requests/day):
//   1. https://dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker
//   2. Replace its code with this file, Deploy
//   3. In SomethingView → Settings → Proxy URL, enter:  https://<your-worker>.<you>.workers.dev/?url=
//
// Only Yahoo Finance hosts are allowed, so this is not an open proxy.
// Set ALLOWED_ORIGIN to your GitHub Pages origin (e.g. "https://yourname.github.io") to lock it down further.

const ALLOWED_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const ALLOWED_ORIGIN = '*'; // e.g. 'https://itgeeksg-jpg.github.io' to restrict

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

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
  },
};
