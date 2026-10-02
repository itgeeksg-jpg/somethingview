// Crypto converter (fiat ⇄ sats ⇄ coin), opened from the top bar.
// Started from joo-bar.com's BTC calc; works for any coin: live Binance price × FX rate,
// Yahoo for coins Binance doesn't (or no longer) trade, CoinGecko as a last resort for BTC.
import { store } from './store.js';
import { h, toast, withTimeout } from './util.js';
import { ICONS } from './icons.js';
import { resolve, cryptoBase } from './symbols.js';
import { loadBars, binanceTicker } from './data.js';
import { prompt } from './dialogs.js';

const SATS = 100_000_000;
const CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'KRW', 'THB', 'MYR', 'JPY', 'AUD', 'HKD', 'CNY'];
const NO_DECIMALS = new Set(['KRW', 'JPY']);
const BASE_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];
const STABLE = new Set(['USDT', 'USDC', 'FDUSD', 'DAI', 'TUSD']);

let panel = null;

// Coins offered: the basics, every coin in your watchlists, and ones you've added with "Other…"
function coinChoices() {
  const out = new Set(BASE_COINS);
  for (const l of Object.values(store.s.lists)) {
    for (const item of l.items) {
      if (item.startsWith('###')) continue;
      const r = resolve(item);
      // Binance pairs / known coins, plus Yahoo crypto tickers like XMR-USD
      const base = cryptoBase(r) || (r.src === 'yahoo' && r.sym.match(/^([A-Z0-9]{2,10})-USD$/)?.[1]);
      if (base && /^[A-Z0-9]{2,10}$/.test(base) && !STABLE.has(base)) out.add(base);
    }
  }
  for (const c of store.s.ui.calcCoins || []) out.add(c);
  return [...out];
}

async function usdPrice(coin) {
  if (STABLE.has(coin)) return { usd: 1, source: 'stablecoin' };
  try {
    const t = await binanceTicker(`${coin}USDT`);
    if (t.live && t.price > 0) return { usd: t.price, source: 'Binance' };
  } catch { /* not on Binance */ }
  const { bars } = await loadBars(resolve(`YAHOO:${coin}-USD`), '1D', { range: '5d' });
  const usd = bars[bars.length - 1]?.close;
  if (!(usd > 0)) throw new Error(`No price found for ${coin}`);
  return { usd, source: 'Yahoo' };
}

// → { rate: fiat per coin, satsPer: sats per coin, source }
async function fetchRate(cur, coin) {
  try {
    const [c, b, fx] = await Promise.all([
      usdPrice(coin),
      coin === 'BTC' ? null : usdPrice('BTC'),
      cur === 'USD' ? 1 : loadBars(resolve(`USD${cur}`), '1D', { range: '5d' }).then(d => d.bars[d.bars.length - 1]?.close),
    ]);
    const btcUsd = b ? b.usd : c.usd;
    if (!(fx > 0)) throw new Error('no FX rate');
    return { rate: c.usd * fx, satsPer: (c.usd / btcUsd) * SATS, source: cur === 'USD' ? c.source : `${c.source} × USD${cur}` };
  } catch (e) {
    if (coin !== 'BTC') throw e;
    const t = withTimeout(8000);
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${cur.toLowerCase()}`, { signal: t.signal, cache: 'no-store' });
      const v = (await res.json())?.bitcoin?.[cur.toLowerCase()];
      if (v > 0) return { rate: v, satsPer: SATS, source: 'CoinGecko' };
      throw e;
    } finally {
      t.done();
    }
  }
}

const num = s => parseFloat(String(s).replace(/[,\s]/g, ''));
const fmtCoin = (v, coin) => (coin === 'BTC' ? v.toFixed(8) : v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 2 : v >= 1 ? 6 : 8 }));

export function toggleCalc(anchor) {
  if (panel) { panel._close(); return; }
  const ui = store.s.ui;
  let cur = CURRENCIES.includes(ui.calcCurrency) ? ui.calcCurrency : 'SGD';
  let coin = ui.calcCoin || 'BTC';
  let rate = null, satsPer = null;
  let last = 'fiat';

  const rateEl = h('div', { class: 'calc-rate' }, `${coin}/${cur} = loading…`);
  const subEl = h('div', { class: 'calc-src muted small' });
  const fiat = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Amount', autocomplete: 'off' });
  const sats = h('input', { class: 'input', inputmode: 'numeric', placeholder: 'SATS', autocomplete: 'off' });
  const amt = h('input', { class: 'input', inputmode: 'decimal', placeholder: coin, autocomplete: 'off' });
  const curSel = h('select', { class: 'input calc-cur', title: 'Currency' }, ...CURRENCIES.map(c => h('option', { value: c, selected: c === cur }, c)));
  const coinSel = h('select', { class: 'input calc-cur', title: 'Coin' });
  const fillCoins = () => {
    const list = coinChoices();
    if (!list.includes(coin)) list.push(coin);
    coinSel.innerHTML = '';
    coinSel.append(...list.map(c => h('option', { value: c, selected: c === coin }, c)), h('option', { value: '__other' }, 'Other…'));
  };
  fillCoins();

  const fmtFiat = v => v.toLocaleString('en-US', { minimumFractionDigits: NO_DECIMALS.has(cur) ? 0 : 2, maximumFractionDigits: NO_DECIMALS.has(cur) ? 0 : 2 });
  const update = from => {
    last = from;
    if (!rate) return;
    let a;
    if (from === 'fiat') a = num(fiat.value) / rate;
    else if (from === 'sats') a = num(sats.value) / satsPer;
    else a = num(amt.value);
    if (!isFinite(a)) return;
    if (from !== 'fiat') fiat.value = fmtFiat(a * rate);
    if (from !== 'sats') sats.value = Math.round(a * satsPer).toLocaleString('en-US');
    if (from !== 'coin') amt.value = fmtCoin(a, coin);
  };
  fiat.addEventListener('input', () => update('fiat'));
  sats.addEventListener('input', () => update('sats'));
  amt.addEventListener('input', () => update('coin'));
  // Tidy the number you typed once you leave the box
  fiat.addEventListener('blur', () => { const v = num(fiat.value); if (isFinite(v)) fiat.value = fmtFiat(v); });
  sats.addEventListener('blur', () => { const v = num(sats.value); if (isFinite(v)) sats.value = Math.round(v).toLocaleString('en-US'); });

  const refresh = async (feedback = false) => {
    const want = `${coin}/${cur}`;
    if (feedback) refreshBtn.textContent = 'Refreshing…';
    try {
      const r = await fetchRate(cur, coin);
      if (want !== `${coin}/${cur}` || !panel) return;
      ({ rate, satsPer } = r);
      // Tiny prices (e.g. PEPE) keep 4 significant digits
      const opts = rate < 1 ? { maximumSignificantDigits: 4 } : { maximumFractionDigits: NO_DECIMALS.has(cur) ? 0 : rate < 100 ? 4 : 2 };
      let txt;
      try { txt = rate.toLocaleString('en', { style: 'currency', currency: cur, ...opts }); } catch { txt = `${rate.toLocaleString('en', opts)} ${cur}`; }
      rateEl.textContent = `${coin}/${cur} = ${txt}`;
      const satsNote = coin === 'BTC' ? '' : satsPer >= 10
        ? ` · 1 ${coin} = ${Math.round(satsPer).toLocaleString('en-US')} sats`
        : ` · 1 sat = ${(1 / satsPer).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${coin}`;
      subEl.textContent = `${r.source} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${satsNote}`;
      update(last);
      if (feedback) { refreshBtn.textContent = 'Refreshed'; setTimeout(() => { refreshBtn.textContent = 'Refresh rate'; }, 1500); }
    } catch (e) {
      if (want !== `${coin}/${cur}`) return;
      rateEl.textContent = `${coin}/${cur} = unavailable`;
      subEl.textContent = e.message;
      if (feedback) refreshBtn.textContent = 'Refresh rate';
    }
  };
  const reset = () => {
    rate = null;
    rateEl.textContent = `${coin}/${cur} = loading…`;
    subEl.textContent = '';
    amt.placeholder = coin;
    refresh();
  };
  curSel.addEventListener('change', () => {
    cur = curSel.value;
    ui.calcCurrency = cur;
    store.save(false);
    reset();
  });
  coinSel.addEventListener('change', async () => {
    let next = coinSel.value;
    if (next === '__other') {
      const t = await prompt('Add a coin', { placeholder: 'Ticker, e.g. PEPE, LINK, KAS', okText: 'Add' });
      next = (t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(USDT|USD)$/, '');
      if (!next) { coinSel.value = coin; return; }
      ui.calcCoins = [...new Set([...(ui.calcCoins || []), next])];
    }
    coin = next;
    ui.calcCoin = coin;
    store.save(false);
    fillCoins();
    reset();
  });

  const copyBtn = input => h('button', { class: 'btn calc-copy', title: 'Copy', onclick: () => {
    navigator.clipboard?.writeText(input.value).then(() => {
      input.classList.add('copied');
      setTimeout(() => input.classList.remove('copied'), 800);
    }, () => toast('Copy failed', 'error'));
  } }, 'Copy');
  const refreshBtn = h('button', { class: 'btn calc-refresh', onclick: () => refresh(true) }, 'Refresh rate');

  panel = h('div', { class: 'calc-panel', role: 'dialog' },
    h('div', { class: 'calc-head' }, h('b', {}, 'Converter'), h('button', { class: 'ibtn sm', title: 'Close (Esc)', html: ICONS.x, onclick: () => close() })),
    rateEl, subEl,
    h('div', { class: 'calc-row' }, fiat, curSel, copyBtn(fiat)),
    h('div', { class: 'calc-row' }, sats, h('span', { class: 'calc-unit' }, 'sats'), copyBtn(sats)),
    h('div', { class: 'calc-row' }, amt, coinSel, copyBtn(amt)),
    refreshBtn);
  document.body.append(panel);
  anchor.classList.add('active');

  const r = anchor.getBoundingClientRect();
  panel.style.top = `${r.bottom + 6}px`;
  panel.style.right = `${Math.max(8, window.innerWidth - r.right - 60)}px`;

  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  // Clicks in dialogs opened from here (e.g. "Other…") don't close the converter
  const onDoc = e => { if (!panel.contains(e.target) && !anchor.contains(e.target) && !e.target.closest?.('#modal-root, .menu')) close(); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.overlay')) close(); };
  setTimeout(() => { document.addEventListener('pointerdown', onDoc); document.addEventListener('keydown', onKey); }, 0);

  function close() {
    clearInterval(timer);
    document.removeEventListener('pointerdown', onDoc);
    document.removeEventListener('keydown', onKey);
    anchor.classList.remove('active');
    panel?.remove();
    panel = null;
  }
  panel._close = close;

  refresh();
  setTimeout(() => fiat.focus(), 30);
}
