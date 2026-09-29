// Bitcoin converter (fiat ⇄ sats ⇄ BTC), opened from the top bar.
// Same idea as joo-bar.com's calc: CoinGecko BTC price, falling back to this app's own data.
import { store } from './store.js';
import { h, toast, withTimeout } from './util.js';
import { ICONS } from './icons.js';
import { resolve } from './symbols.js';
import { loadBars, binancePrice } from './data.js';

const SATS = 100_000_000;
const CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'KRW', 'THB', 'MYR', 'JPY', 'AUD', 'HKD', 'CNY'];
const NO_DECIMALS = new Set(['KRW', 'JPY']);

let panel = null;

// Live Binance BTC/USDT × the USD→currency FX rate; CoinGecko only if that fails
async function fetchRate(cur) {
  try {
    const [usd, fx] = await Promise.all([
      binancePrice('BTCUSDT'),
      cur === 'USD' ? 1 : loadBars(resolve(`USD${cur}`), '1D', { range: '5d' }).then(d => d.bars[d.bars.length - 1]?.close),
    ]);
    if (usd > 0 && fx > 0) return { rate: usd * fx, source: cur === 'USD' ? 'Binance' : `Binance × USD${cur}` };
    throw new Error('no rate');
  } catch {
    const t = withTimeout(8000);
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${cur.toLowerCase()}`, { signal: t.signal, cache: 'no-store' });
      const v = (await res.json())?.bitcoin?.[cur.toLowerCase()];
      if (v > 0) return { rate: v, source: 'CoinGecko' };
      throw new Error('no rate');
    } finally {
      t.done();
    }
  }
}

const num = s => parseFloat(String(s).replace(/[,\s]/g, ''));

export function toggleCalc(anchor) {
  if (panel) { panel._close(); return; }
  const ui = store.s.ui;
  let cur = CURRENCIES.includes(ui.calcCurrency) ? ui.calcCurrency : 'SGD';
  let rate = null;
  let last = 'fiat';

  const rateEl = h('div', { class: 'calc-rate' }, 'BTC/', cur, ' = loading…');
  const srcEl = h('div', { class: 'calc-src muted small' });
  const fiat = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Amount', autocomplete: 'off' });
  const sats = h('input', { class: 'input', inputmode: 'numeric', placeholder: 'SATS', autocomplete: 'off' });
  const btc = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'BTC', autocomplete: 'off' });
  const select = h('select', { class: 'input calc-cur' }, ...CURRENCIES.map(c => h('option', { value: c, selected: c === cur }, c)));

  const fmtFiat = v => v.toLocaleString('en-US', { minimumFractionDigits: NO_DECIMALS.has(cur) ? 0 : 2, maximumFractionDigits: NO_DECIMALS.has(cur) ? 0 : 2 });
  const update = from => {
    last = from;
    if (!rate) return;
    let b;
    if (from === 'fiat') b = num(fiat.value) / rate;
    else if (from === 'sats') b = num(sats.value) / SATS;
    else b = num(btc.value);
    if (!isFinite(b)) return;
    if (from !== 'fiat') fiat.value = fmtFiat(b * rate);
    if (from !== 'sats') sats.value = Math.round(b * SATS).toLocaleString('en-US');
    if (from !== 'btc') btc.value = b.toFixed(8);
  };
  fiat.addEventListener('input', () => update('fiat'));
  sats.addEventListener('input', () => update('sats'));
  btc.addEventListener('input', () => update('btc'));
  // Tidy the number you typed once you leave the box
  fiat.addEventListener('blur', () => { const v = num(fiat.value); if (isFinite(v)) fiat.value = fmtFiat(v); });
  sats.addEventListener('blur', () => { const v = num(sats.value); if (isFinite(v)) sats.value = Math.round(v).toLocaleString('en-US'); });

  const refresh = async (feedback = false) => {
    const want = cur;
    if (feedback) refreshBtn.textContent = 'Refreshing…';
    try {
      const r = await fetchRate(want);
      if (want !== cur || !panel) return;
      rate = r.rate;
      let txt;
      try { txt = rate.toLocaleString('en', { style: 'currency', currency: cur, maximumFractionDigits: NO_DECIMALS.has(cur) ? 0 : 2 }); } catch { txt = `${rate.toLocaleString('en')} ${cur}`; }
      rateEl.textContent = `BTC/${cur} = ${txt}`;
      srcEl.textContent = `${r.source} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      update(last);
      if (feedback) { refreshBtn.textContent = 'Refreshed'; setTimeout(() => { refreshBtn.textContent = 'Refresh rate'; }, 1500); }
    } catch {
      rateEl.textContent = `BTC/${cur} = error`;
      if (feedback) refreshBtn.textContent = 'Refresh rate';
    }
  };
  select.addEventListener('change', () => {
    cur = select.value;
    ui.calcCurrency = cur;
    store.save(false);
    rate = null;
    rateEl.textContent = `BTC/${cur} = loading…`;
    refresh();
  });

  const copyBtn = input => h('button', { class: 'btn calc-copy', title: 'Copy', onclick: () => {
    navigator.clipboard?.writeText(input.value).then(() => {
      input.classList.add('copied');
      setTimeout(() => input.classList.remove('copied'), 800);
    }, () => toast('Copy failed', 'error'));
  } }, 'Copy');
  const refreshBtn = h('button', { class: 'btn calc-refresh', onclick: () => refresh(true) }, 'Refresh rate');

  panel = h('div', { class: 'calc-panel', role: 'dialog' },
    h('div', { class: 'calc-head' }, h('b', {}, 'BTC converter'), h('button', { class: 'ibtn sm', title: 'Close (Esc)', html: ICONS.x, onclick: () => close() })),
    rateEl, srcEl,
    h('div', { class: 'calc-row' }, fiat, select, copyBtn(fiat)),
    h('div', { class: 'calc-row' }, sats, h('span', { class: 'calc-unit' }, 'sats'), copyBtn(sats)),
    h('div', { class: 'calc-row' }, btc, h('span', { class: 'calc-unit' }, 'BTC'), copyBtn(btc)),
    refreshBtn);
  document.body.append(panel);
  anchor.classList.add('active');

  const r = anchor.getBoundingClientRect();
  panel.style.top = `${r.bottom + 6}px`;
  panel.style.right = `${Math.max(8, window.innerWidth - r.right - 60)}px`;

  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  const onDoc = e => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
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
