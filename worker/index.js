// SomethingView on Cloudflare Workers (free plan):
//   /login          sign-in page; a successful login sets a signed cookie valid for a year
//   /*              the app's static files (only when signed in)
//   /api/yahoo      proxies Yahoo Finance (Yahoo has no CORS)
//   /api/sync/me    the signed-in account's watchlists/indicators/drawings/layout, shared by all its devices
//
// Secrets (set with `npx wrangler secret put NAME`, never committed): AUTH_USER, AUTH_PASS, SESSION_SECRET

const ALLOWED_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const MAX_SYNC_BYTES = 2_000_000;
const COOKIE = 'sv_session';
const SESSION_DAYS = 365;
// Needed before login: the login page's icon and the home-screen manifest (fetched without cookies)
const PUBLIC_PATHS = new Set(['/login', '/icon.svg', '/manifest.webmanifest']);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

// Constant-time string comparison
function same(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

// ---------------------------------------------------------------- auth
// Changing AUTH_USER / AUTH_PASS / SESSION_SECRET signs every device out.
const sessionMsg = (env, exp) => `sv1:${exp}:${env.AUTH_USER}:${env.AUTH_PASS}`;

async function makeSession(env) {
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  return `${exp}.${await hmac(env.SESSION_SECRET, sessionMsg(env, exp))}`;
}

async function signedIn(request, env) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9]+)\\.([a-f0-9]{64})`));
  if (!m || +m[1] < Date.now()) return false;
  return same(m[2], await hmac(env.SESSION_SECRET, sessionMsg(env, m[1])));
}

const loginPage = (error = '') => new Response(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SomethingView — Sign in</title><link rel="icon" href="/icon.svg"><meta name="theme-color" content="#131722">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #131722; color: #d1d4dc;
    font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif; padding: 16px; }
  form { width: 100%; max-width: 340px; background: #1e222d; border: 1px solid #2a2e39; border-radius: 12px; padding: 28px 24px; }
  h1 { display: flex; align-items: center; gap: 10px; margin: 0 0 22px; font-size: 20px; color: #fff; }
  h1 img { width: 30px; height: 30px; }
  label { display: block; font-size: 13px; color: #787b86; margin: 14px 0 6px; }
  input { width: 100%; height: 42px; padding: 0 12px; border-radius: 8px; border: 1px solid #2a2e39; background: #131722; color: #fff; font: inherit; outline: none; }
  input:focus { border-color: #2962ff; }
  button { width: 100%; height: 44px; margin-top: 22px; border: 0; border-radius: 8px; background: #2962ff; color: #fff; font: 600 15px inherit; cursor: pointer; }
  button:hover { background: #1e53e5; }
  .err { margin: 14px 0 0; color: #f23645; font-size: 13px; }
</style></head><body>
<form method="post" action="/login" id="f">
  <h1><img src="/icon.svg" alt="">SomethingView</h1>
  <label for="u">Username</label><input id="u" name="username" autocomplete="username" autocapitalize="none" required autofocus>
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
  <input type="hidden" name="hash" id="h">
  ${error ? `<p class="err">${error}</p>` : ''}
  <button type="submit">Sign in</button>
</form>
<script>
  // Keep "#sync=..." / "#list=..." links working through the sign-in
  document.getElementById('f').addEventListener('submit', () => { document.getElementById('h').value = location.hash; });
</script>
</body></html>`, { status: error ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

async function handleLogin(request, env) {
  if (request.method !== 'POST') return loginPage();
  const form = await request.formData().catch(() => null);
  const user = form?.get('username') || '', pass = form?.get('password') || '';
  if (!env.AUTH_USER || !env.AUTH_PASS || !env.SESSION_SECRET) return loginPage('Login is not configured on the server.');
  if (!(same(user.trim().toLowerCase(), env.AUTH_USER.toLowerCase()) & same(pass, env.AUTH_PASS))) {
    await new Promise(r => setTimeout(r, 800)); // slow down guessing
    return loginPage('Wrong username or password.');
  }
  const hash = String(form.get('hash') || '');
  const target = '/' + (/^#[\w=.-]*$/.test(hash) ? hash : '');
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      'Set-Cookie': `${COOKIE}=${await makeSession(env)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

// ---------------------------------------------------------------- sync
async function handleSync(request, env, key) {
  // "me" = the signed-in account: every device logged in as the same user shares one copy.
  // (Random device keys from the earlier pairing scheme still work.)
  let id;
  if (key === 'me') id = `account:${env.AUTH_USER.toLowerCase()}`;
  else if (/^[a-f0-9]{32}$/.test(key)) id = await sha256(key);
  else return json({ error: 'bad key' }, 400);
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

// Short-lived pairing codes: a device gets a code like "K7P4QX" that another device types in
// to receive its sync key (single use, 10 minutes)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function handlePair(request, env, code) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM pair WHERE expires < ?').bind(now).run();
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (!/^[a-f0-9]{32}$/.test(body.key || '')) return json({ error: 'bad key' }, 400);
    const newCode = [...crypto.getRandomValues(new Uint8Array(6))].map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
    const expires = now + 10 * 60 * 1000;
    await env.DB.prepare('INSERT OR REPLACE INTO pair (code, key, expires) VALUES (?, ?, ?)').bind(newCode, body.key, expires).run();
    return json({ code: newCode, expires });
  }
  if (request.method === 'GET') {
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = await env.DB.prepare('SELECT key FROM pair WHERE code = ? AND expires >= ?').bind(code, now).first();
    if (!row) return json({ error: 'Code not found or expired' }, 404);
    await env.DB.prepare('DELETE FROM pair WHERE code = ?').bind(code).run();
    return json({ key: row.key });
  }
  return json({ error: 'method not allowed' }, 405);
}

// ---------------------------------------------------------------- Yahoo proxy
async function handleYahoo(request, ctx) {
  const target = new URL(request.url).searchParams.get('url');
  let url;
  try { url = new URL(target); } catch { return new Response('Missing or invalid ?url=', { status: 400 }); }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) return new Response('Host not allowed', { status: 403 });

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
  return new Response(res.body, res);
}

// ---------------------------------------------------------------- router
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/login') return handleLogin(request, env);
    if (path === '/logout') {
      return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
    }

    if (!PUBLIC_PATHS.has(path) && !(await signedIn(request, env))) {
      if (path.startsWith('/api/')) return json({ error: 'Not signed in — reload the page to sign in' }, 401);
      return new Response(null, { status: 302, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
    }

    if (path === '/api/yahoo') return handleYahoo(request, ctx);
    if (path.startsWith('/api/sync/')) return handleSync(request, env, path.slice('/api/sync/'.length));
    if (path === '/api/pair' || path.startsWith('/api/pair/')) return handlePair(request, env, path.slice('/api/pair/'.length));

    // Static app files. no-cache = the browser revalidates each time, so devices never run stale code.
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-cache');
    return out;
  },
};
