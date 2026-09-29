// Market data providers.
//  - Binance (public REST + websocket, CORS-enabled, real-time) for BINANCE:/USDT pairs
//  - Yahoo Finance (via a CORS proxy) for everything else: stocks, indices, FX, futures, crypto USD pairs
import { store } from './store.js';
import { withTimeout } from './util.js';
import { resolve, aliasMatches, splitBinance } from './symbols.js';

export const INTERVALS = {
  '1m': { label: '1 minute', sec: 60, bn: '1m', yi: '1m', yr: '5d', poll: '1d' },
  '5m': { label: '5 minutes', sec: 300, bn: '5m', yi: '5m', yr: '1mo', poll: '1d' },
  '15m': { label: '15 minutes', sec: 900, bn: '15m', yi: '15m', yr: '60d', poll: '1d' },
  '30m': { label: '30 minutes', sec: 1800, bn: '30m', yi: '30m', yr: '60d', poll: '1d' },
  '1h': { label: '1 hour', sec: 3600, bn: '1h', yi: '60m', yr: '730d', poll: '5d' },
  '2h': { label: '2 hours', sec: 7200, bn: '2h', yi: '60m', yr: '730d', poll: '5d', agg: 7200 },
  '4h': { label: '4 hours', sec: 14400, bn: '4h', yi: '60m', yr: '730d', poll: '5d', agg: 14400 },
  '1D': { label: '1 day', sec: 86400, bn: '1d', yi: '1d', yr: 'max', poll: '5d', daily: true },
  '1W': { label: '1 week', sec: 604800, bn: '1w', yi: '1wk', yr: 'max', poll: '1mo', daily: true },
  '1M': { label: '1 month', sec: 2592000, bn: '1M', yi: '1mo', yr: 'max', poll: '3mo', daily: true },
};

// Small first request so the chart appears fast; full history follows in the background
export const QUICK_RANGE = { '1m': '1d', '5m': '5d', '15m': '5d', '30m': '1mo', '1h': '3mo', '2h': '3mo', '4h': '6mo', '1D': '1y', '1W': '5y' };

const DAY = 86400;
// Intraday bars are shifted so the time axis shows the viewer's local time.
const toLocal = t => t - new Date(t * 1000).getTimezoneOffset() * 60;

function alignDaily(t, iv, gmtoff = 0) {
  let d = Math.floor((t + gmtoff) / DAY) * DAY;
  if (iv === '1W') {
    const dow = (Math.floor(d / DAY) + 4) % 7; // 0 = Sunday
    d -= ((dow + 6) % 7) * DAY;
  } else if (iv === '1M') {
    const dt = new Date(d * 1000);
    d = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) / 1000;
  }
  return d;
}

// Sort + merge bars that landed in the same bucket
function normalize(bars) {
  bars.sort((a, b) => a.time - b.time);
  const out = [];
  for (const b of bars) {
    const p = out[out.length - 1];
    if (p && p.time === b.time) {
      p.high = Math.max(p.high, b.high);
      p.low = Math.min(p.low, b.low);
      p.close = b.close;
      p.volume = Math.max(p.volume, b.volume);
    } else out.push({ ...b });
  }
  return out;
}

function aggregate(bars, sec) {
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.time / sec) * sec;
    const p = out[out.length - 1];
    if (p && p.time === t) {
      p.high = Math.max(p.high, b.high);
      p.low = Math.min(p.low, b.low);
      p.close = b.close;
      p.volume += b.volume;
    } else out.push({ ...b, time: t });
  }
  return out;
}

function precisionFromPrices(bars) {
  let p = 0;
  for (let i = Math.max(0, bars.length - 50); i < bars.length; i++) {
    for (const v of [bars[i].open, bars[i].close, bars[i].high, bars[i].low]) {
      const s = String(+v.toPrecision(12));
      const dec = s.includes('.') ? s.split('.')[1].length : 0;
      p = Math.max(p, dec);
    }
  }
  return Math.min(p, 8);
}

// ---------------------------------------------------------------- Yahoo via proxy
// Your own proxy (worker/cors-proxy.js on Cloudflare). Used on every device without any setup.
export const DEFAULT_PROXY = '';

const tmpl = base => u => (base.includes('{url}') ? base.replace('{url}', encodeURIComponent(u)) : base + encodeURIComponent(u));
// Free public fallbacks: unreliable, used only when no own proxy is reachable
const PUBLIC_PROXIES = [
  { build: tmpl('https://api.allorigins.win/raw?url=') },
  { build: tmpl('https://api.allorigins.win/get?url='), unwrap: j => JSON.parse(j.contents) },
];
let proxyStart = 0;

// Limit concurrent proxy requests so public proxies don't rate-limit us
let active = 0;
const queue = [];
async function slot(fn) {
  if (active >= 4) await new Promise(r => queue.push(r));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

export class DataError extends Error {}

function proxyList() {
  const own = [store.s.settings.proxy.trim(), DEFAULT_PROXY].filter(Boolean);
  const list = [...new Set(own)].map(p => ({ build: tmpl(p), own: true }));
  const pub = PUBLIC_PROXIES.map((_, i) => PUBLIC_PROXIES[(i + proxyStart) % PUBLIC_PROXIES.length]);
  // Public proxies fail often; give them a second chance
  return list.concat(pub, pub);
}

async function yahoo(url, timeout = 20000) {
  const list = proxyList();
  let lastErr;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const t = withTimeout(p.own ? timeout : Math.min(timeout, 25000));
    try {
      const res = await slot(() => fetch(p.build(url), { signal: t.signal }));
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); if (p.unwrap) json = p.unwrap(json); } catch { throw new Error(`proxy returned HTTP ${res.status}`); }
      const err = json?.chart?.error || json?.finance?.error;
      if (err) throw new DataError(err.description || err.code || 'Yahoo error');
      const pi = PUBLIC_PROXIES.indexOf(p);
      if (pi >= 0) proxyStart = pi;
      return json;
    } catch (e) {
      if (e instanceof DataError) throw e;
      lastErr = e;
    } finally {
      t.done();
    }
  }
  const hasOwn = list.some(p => p.own);
  throw new Error(`Yahoo data unavailable (${lastErr?.name === 'AbortError' ? 'proxy timed out' : lastErr?.message || 'proxy failed'}). ` +
    (hasOwn ? 'Your proxy did not respond — check it in Settings.' : 'The free public proxy is down: set up your own proxy (Settings).'));
}

const YQ = 'https://query1.finance.yahoo.com';

function parseYahooChart(json, iv) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new DataError('No data for symbol');
  const m = r.meta || {};
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const conf = INTERVALS[iv];
  let bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], hi = q.high?.[i], lo = q.low?.[i], c = q.close?.[i];
    if (c == null || o == null || hi == null || lo == null) continue;
    bars.push({ time: ts[i], open: o, high: hi, low: lo, close: c, volume: q.volume?.[i] || 0 });
  }
  if (!conf.daily && bars.length > 1) {
    // Yahoo appends an off-grid "closing print" (e.g. 16:00 on 60m bars); drop it
    const step = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '60m': 3600 }[conf.yi];
    const a = bars[bars.length - 2], b = bars[bars.length - 1];
    if (step && (b.time - a.time) % step !== 0) bars.pop();
  }
  if (conf.daily) {
    bars.forEach(b => { b.time = alignDaily(b.time, iv, m.gmtoffset || 0); });
  } else {
    if (conf.agg) bars = aggregate(bars, conf.agg);
    bars.forEach(b => { b.time = toLocal(b.time); });
  }
  bars = normalize(bars);
  return {
    bars,
    meta: {
      name: m.longName || m.shortName || m.symbol,
      exchange: m.fullExchangeName || m.exchangeName || '',
      currency: m.currency || '',
      type: (m.instrumentType || '').toLowerCase(),
      precision: m.priceHint ?? precisionFromPrices(bars),
    },
  };
}

async function yahooBars(sym, iv, range) {
  const conf = INTERVALS[iv];
  const r = range || conf.yr;
  // range=max silently downgrades to monthly bars, so ask for explicit dates instead
  const span = r === 'max' ? `period1=0&period2=${Math.floor(Date.now() / 10000) * 10}` : `range=${r}`;
  const url = `${YQ}/v8/finance/chart/${encodeURIComponent(sym)}?interval=${conf.yi}&${span}&includePrePost=false&_=${Math.floor(Date.now() / 10000)}`;
  return parseYahooChart(await yahoo(url, r === 'max' || r === '730d' ? 90000 : 20000), iv);
}

// ---------------------------------------------------------------- Binance
const BN_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api.binance.us'];
const BN_WS = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443'];
let bnHost = 0;

async function binance(path) {
  let lastErr;
  for (let i = 0; i < BN_HOSTS.length; i++) {
    const host = BN_HOSTS[(i + bnHost) % BN_HOSTS.length];
    const t = withTimeout(15000);
    try {
      const res = await fetch(host + path, { signal: t.signal });
      if (res.status === 400) {
        const j = await res.json().catch(() => ({}));
        throw new DataError(j.msg || 'Invalid Binance request');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bnHost = (i + bnHost) % BN_HOSTS.length;
      return await res.json();
    } catch (e) {
      if (e instanceof DataError) throw e;
      lastErr = e;
    } finally {
      t.done();
    }
  }
  throw new Error('Binance unavailable: ' + (lastErr?.message || 'network error'));
}

function bnToBar(k, iv) {
  const t = k[0] / 1000;
  return {
    time: INTERVALS[iv].daily ? t : toLocal(t),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  };
}

async function binanceBars(sym, iv, { endTime, pages } = {}) {
  const conf = INTERVALS[iv];
  pages ??= conf.daily ? 12 : 2;
  let all = [];
  let end = endTime;
  let hasMore = false;
  for (let p = 0; p < pages; p++) {
    const k = await binance(`/api/v3/klines?symbol=${sym}&interval=${conf.bn}&limit=1000${end ? `&endTime=${end}` : ''}`);
    all = k.concat(all);
    hasMore = k.length === 1000;
    if (!hasMore) break;
    end = k[0][0] - 1;
  }
  const bars = normalize(all.map(k => bnToBar(k, iv)));
  const [base, quote] = splitBinance(sym);
  return {
    bars,
    cursor: all.length ? all[0][0] - 1 : null,
    hasMore,
    meta: { name: '', exchange: 'Binance', currency: quote, type: 'crypto', precision: precisionFromPrices(bars), base },
  };
}

let bnSymbols = null;
async function binanceSymbols() {
  if (!bnSymbols) {
    bnSymbols = binance('/api/v3/ticker/price')
      .then(list => new Set(list.map(x => x.symbol)))
      .catch(e => { bnSymbols = null; throw e; });
  }
  return bnSymbols;
}

// ---------------------------------------------------------------- Public API
const barCache = new Map();

export async function loadBars(res, iv, { range } = {}) {
  const ck = `${res.src}:${res.sym}|${iv}|${range || ''}`;
  const c = barCache.get(ck);
  if (c && Date.now() - c.at < 30000) return c.data;
  const data = res.src === 'binance'
    ? await binanceBars(res.sym, iv, range ? { pages: 1 } : {})
    : await yahooBars(res.sym, iv, range);
  barCache.set(ck, { at: Date.now(), data });
  return data;
}

export async function loadOlder(res, iv, cursor) {
  if (res.src !== 'binance' || cursor == null) return null;
  return binanceBars(res.sym, iv, { endTime: cursor, pages: 1 });
}

function reconnectingSocket(buildUrl, onMessage) {
  let ws, closed = false, attempt = 0, timer;
  const open = () => {
    if (closed) return;
    ws = new WebSocket(buildUrl(BN_WS[attempt % BN_WS.length]));
    ws.onmessage = e => { attempt = 0; try { onMessage(JSON.parse(e.data)); } catch { /* ignore bad frame */ } };
    ws.onclose = () => {
      if (closed) return;
      attempt++;
      timer = setTimeout(open, Math.min(30000, 1000 * attempt));
    };
    ws.onerror = () => ws.close();
  };
  open();
  return () => { closed = true; clearTimeout(timer); ws?.close(); };
}

// Live bar updates. Returns an unsubscribe function.
export function subscribeBars(res, iv, onBar) {
  if (res.src === 'binance') {
    const stream = `${res.sym.toLowerCase()}@kline_${INTERVALS[iv].bn}`;
    return reconnectingSocket(host => `${host}/ws/${stream}`, m => {
      const k = m.k;
      if (!k) return;
      onBar(bnToBar([k.t, k.o, k.h, k.l, k.c, k.v], iv));
    });
  }
  let stopped = false;
  const tick = async () => {
    if (stopped || document.hidden) return;
    try {
      const { bars } = await yahooBars(res.sym, iv, INTERVALS[iv].poll);
      if (!stopped) bars.slice(-3).forEach(onBar);
    } catch { /* keep polling */ }
  };
  const id = setInterval(tick, Math.max(10, store.s.settings.refreshSec) * 1000);
  return () => { stopped = true; clearInterval(id); };
}

// ---------------------------------------------------------------- Quotes
export const quotes = new Map(); // qkey -> quote
export const qkey = r => `${r.src}:${r.sym}`;

function isOpen(period) {
  const now = Date.now() / 1000;
  return period ? now >= period.start && now < period.end : null;
}

async function yahooQuotes(syms) {
  const out = [];
  for (let i = 0; i < syms.length; i += 20) {
    const batch = syms.slice(i, i + 20);
    const url = `${YQ}/v7/finance/spark?symbols=${encodeURIComponent(batch.join(','))}&range=1d&interval=1d&_=${Math.floor(Date.now() / 10000)}`;
    out.push(yahoo(url).then(json => {
      // One bad ticker can fail the whole batch; retry the rest one by one
      if (!json?.spark?.result && batch.length > 1) return yahooQuotesEach(batch);
      const got = new Set();
      for (const r of json?.spark?.result || []) {
        got.add(r.symbol);
        const m = r.response?.[0]?.meta;
        if (!m || m.regularMarketPrice == null) continue;
        const prev = m.chartPreviousClose ?? m.previousClose;
        const change = prev != null ? m.regularMarketPrice - prev : null;
        quotes.set(`yahoo:${r.symbol}`, {
          price: m.regularMarketPrice, prev, change, pct: prev ? (change / prev) * 100 : null,
          high: m.regularMarketDayHigh, low: m.regularMarketDayLow, volume: m.regularMarketVolume,
          w52h: m.fiftyTwoWeekHigh, w52l: m.fiftyTwoWeekLow,
          name: m.longName || m.shortName, exchange: m.fullExchangeName || m.exchangeName, currency: m.currency,
          type: (m.instrumentType || '').toLowerCase(), precision: m.priceHint,
          open: isOpen(m.currentTradingPeriod?.regular), time: m.regularMarketTime,
          tz: m.exchangeTimezoneName,
        });
      }
      // Mark symbols Yahoo has no data for, so the UI can stop showing a spinner
      for (const sym of batch) if (!got.has(sym) && !quotes.has(`yahoo:${sym}`)) quotes.set(`yahoo:${sym}`, { missing: true });
    }).catch(() => {}));
  }
  await Promise.all(out);
}

const badYahoo = new Set();
function yahooQuotesEach(syms) {
  return Promise.all(syms.filter(s => !badYahoo.has(s)).map(s => yahooQuotes([s]).then(() => {
    if (!quotes.has(`yahoo:${s}`)) badYahoo.add(s);
  })));
}

function bnQuote(sym, t) {
  const price = +t.c, open = +t.o;
  const prev = quotes.get(`binance:${sym}`) || {};
  quotes.set(`binance:${sym}`, {
    ...prev,
    price, prev: open, change: price - open, pct: open ? ((price - open) / open) * 100 : null,
    high: +t.h, low: +t.l, volume: +t.v, quoteVolume: +t.q, exchange: 'Binance', type: 'crypto', open: true,
    currency: splitBinance(sym)[1],
  });
}

async function binanceQuotes(syms) {
  const known = await binanceSymbols().catch(() => null);
  const ok = known ? syms.filter(s => known.has(s)) : syms;
  if (!ok.length) return;
  for (let i = 0; i < ok.length; i += 100) {
    const batch = ok.slice(i, i + 100);
    try {
      const list = await binance(`/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(batch))}`);
      for (const t of list) bnQuote(t.symbol, { c: t.lastPrice, o: t.openPrice, h: t.highPrice, l: t.lowPrice, v: t.volume, q: t.quoteVolume });
    } catch { /* ignore */ }
  }
}

// Keeps quotes for a set of symbols fresh. onUpdate() is called after changes.
export class QuoteFeed {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.yahoo = [];
    this.binance = [];
    this.stopWs = null;
    this.timer = setInterval(() => this.poll(), Math.max(10, store.s.settings.refreshSec) * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poll(); });
  }

  setSymbols(resList) {
    const y = [...new Set(resList.filter(r => r.src === 'yahoo').map(r => r.sym))];
    const b = [...new Set(resList.filter(r => r.src === 'binance').map(r => r.sym))];
    const bChanged = b.join() !== this.binance.join();
    this.yahoo = y;
    this.binance = b;
    if (bChanged) {
      this.stopWs?.();
      this.stopWs = null;
      if (b.length) {
        binanceQuotes(b).then(() => this.onUpdate());
        let changed = null;
        const streams = b.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        this.stopWs = reconnectingSocket(host => `${host}/stream?streams=${streams}`, m => {
          const d = m.data;
          if (!d?.s) return;
          bnQuote(d.s, d);
          if (!changed) {
            changed = new Set();
            requestAnimationFrame(() => { const c = changed; changed = null; this.onUpdate(c); });
          }
          changed.add(d.s);
        });
      }
    }
    return yahooQuotes(y).then(() => this.onUpdate());
  }

  poll() {
    if (document.hidden || !this.yahoo.length) return;
    yahooQuotes(this.yahoo).then(() => this.onUpdate());
  }
}

// ---------------------------------------------------------------- Search
// Calls onUpdate(results) progressively as each source answers; resolves with the final list.
export async function searchSymbols(q, onUpdate = () => {}) {
  q = q.trim();
  if (!q) return [];
  const Q = q.toUpperCase().replace(/[\s/-]/g, '');
  const cryptoFirst = /USDT$|USDC$|^BTC|^ETH/.test(Q);
  let bnList = [], yq = [];

  const assemble = () => {
    const seen = new Set();
    const out = [];
    const add = r => { if (!seen.has(r.key)) { seen.add(r.key); out.push(r); } };
    for (const a of aliasMatches(Q).slice(0, 6)) add({ ...a, src: 'yahoo' });
    const pushYahoo = x => {
      const r = resolve(x.symbol);
      const key = r.src === 'yahoo' && r.sym === x.symbol ? x.symbol : `YAHOO:${x.symbol}`;
      add({ key, desc: x.longname || x.shortname || '', type: (x.typeDisp || x.quoteType || '').toLowerCase(), exchange: x.exchDisp || x.exchange || '', src: 'yahoo' });
    };
    // Yahoo first for stocks, Binance first when the query looks like a crypto pair
    if (!cryptoFirst) yq.forEach(pushYahoo);
    for (const s of bnList) {
      const r = resolve('BINANCE:' + s);
      add({ key: r.key, desc: r.desc, type: 'crypto', exchange: 'Binance', src: 'binance' });
    }
    if (cryptoFirst) yq.forEach(pushYahoo);
    // Whatever was typed is always an option
    const typed = resolve(q);
    add({ key: typed.key, desc: typed.desc || 'Use as typed', type: typed.type, exchange: typed.src === 'binance' ? 'Binance' : typed.exchange || 'Yahoo', src: typed.src });
    return out;
  };

  onUpdate(assemble());
  await Promise.allSettled([
    binanceSymbols().then(set => {
      bnList = [...set].filter(s => s.startsWith(Q)).sort((a, b) => a.length - b.length).slice(0, 10);
      onUpdate(assemble());
    }),
    yahoo(`${YQ}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&listsCount=0&enableFuzzyQuery=false`).then(j => {
      yq = (j.quotes || []).filter(x => x.symbol && x.isYahooFinance !== false);
      onUpdate(assemble());
    }),
  ]);
  const out = assemble();
  onUpdate(out);
  return out;
}
