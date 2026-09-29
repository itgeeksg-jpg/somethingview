import { store, DEFAULT_INDICATORS } from './store.js';
import { $, h, uid, toast, download, pickFile, isTyping, fmtPrice, fmtPct, autoPrecision } from './util.js';
import { ICONS } from './icons.js';
import { resolve } from './symbols.js';
import { INTERVALS, QUICK_RANGE, loadBars, loadOlder, subscribeBars, QuoteFeed, getQuote } from './data.js';
import { ChartView, CHART_TYPES } from './chart.js';
import { TOOLS } from './drawings.js';
import { INDICATORS } from './indicators.js';
import { Watchlist } from './watchlist.js';
import { Details } from './details.js';
import { menu, modal, prompt, confirm, symbolSearch, indicatorPicker, indicatorSettings } from './dialogs.js';
import * as sync from './sync.js';

const s = () => store.s;
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

let cv, wl, details, feed;
let ctx = null; // { res, iv, cursor, hasMore, loadingOlder }
let loadSeq = 0;
let unsubBars = null;

// ------------------------------------------------------------------ chart loading
function showMsg(html, retry) {
  const el = $('#chart-msg');
  el.innerHTML = '';
  if (!html) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.append(h('div', { class: 'msg-box', html }));
  if (retry) el.firstChild.append(h('div', { class: 'msg-actions' },
    h('button', { class: 'btn primary', onclick: retry }, 'Retry'),
    h('button', { class: 'btn', onclick: openSettings }, 'Settings')));
}

async function loadChart() {
  const seq = ++loadSeq;
  const res = resolve(s().symbol);
  const iv = s().interval;
  unsubBars?.();
  unsubBars = null;
  ctx = null;
  renderSymbolButton();
  setFeedStatus(res, 'loading');
  const slow = setTimeout(() => { if (seq === loadSeq) showMsg('<div class="spinner"></div>Loading…'); }, 350);
  try {
    const quick = res.src !== 'binance' ? QUICK_RANGE[iv] : null;
    const data = await loadBars(res, iv, quick ? { range: quick } : {});
    if (seq !== loadSeq) return;
    if (!data.bars.length) throw new Error('No data for this symbol / timeframe');
    const name = data.meta.name || res.desc || '';
    const exch = data.meta.exchange || (res.src === 'binance' ? 'Binance' : '');
    cv.setData(data, {
      title: res.display,
      subtitle: [name && name !== res.display ? name : null, iv, exch].filter(Boolean).map(x => ` · ${x}`).join(''),
      interval: iv, reset: true,
    });
    ctx = { res, iv, cursor: data.cursor, hasMore: data.hasMore, loadingOlder: false };
    cv.drawings.setItems(s().drawings[res.key] || []);
    details.set(res, data.meta);
    unsubBars = subscribeBars(res, iv, bar => { cv.updateBar(bar); updateTitle(); });
    showMsg(null);
    setFeedStatus(res, 'ok');
    updateTitle();
    if (quick) {
      setFeedStatus(res, 'history');
      loadBars(res, iv)
        .then(full => { if (seq === loadSeq) cv.replaceHistory(full.bars); })
        .catch(() => {})
        .finally(() => { if (seq === loadSeq) setFeedStatus(res, 'ok'); });
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    console.error(e);
    setFeedStatus(res, 'error');
    showMsg(`<b>Couldn't load ${res.display}</b><p>${e.message}</p>`, () => loadChart());
    details.set(res, {});
  } finally {
    clearTimeout(slow);
  }
}

async function loadOlderBars() {
  const c = ctx;
  if (!c || !c.hasMore || c.loadingOlder) return;
  c.loadingOlder = true;
  try {
    const d = await loadOlder(c.res, c.iv, c.cursor);
    if (d && c === ctx) {
      cv.prepend(d.bars);
      c.cursor = d.cursor;
      c.hasMore = d.hasMore;
    }
  } catch { c.hasMore = false; } finally { c.loadingOlder = false; }
}

function setSymbol(key) {
  const r = resolve(key);
  if (r.key === s().symbol && ctx) return;
  s().symbol = r.key;
  store.save();
  wl.setActive(r.key);
  refreshFeed();
  if (isMobile()) document.body.classList.remove('watch-open');
  return loadChart();
}

function setInterval_(iv) {
  if (!INTERVALS[iv]) return;
  s().interval = iv;
  store.save();
  renderIntervals();
  return loadChart();
}

function refreshFeed() {
  const items = (wl.list?.items || []).filter(x => !x.startsWith('###')).map(k => resolve(k));
  items.push(resolve(s().symbol));
  feed.setSymbols(items);
}

function updateTitle() {
  const r = resolve(s().symbol);
  const q = getQuote(r);
  const last = cv.bars[cv.bars.length - 1];
  const price = q?.price ?? last?.close;
  document.title = price != null
    ? `${r.display} ${fmtPrice(price, q?.precision ?? cv.precision ?? autoPrecision(price))} ${q?.pct != null ? fmtPct(q.pct) : ''} — SomethingView`
    : 'SomethingView';
}

function setFeedStatus(res, state) {
  const el = $('#feed-status');
  const live = res.src === 'binance';
  const label = state === 'loading' ? 'Loading…' : state === 'error' ? 'Data error' : state === 'history' ? 'Loading history…'
    : live ? 'Binance · live' : `${res.src === 'synthetic' ? 'Calculated' : 'Yahoo'} · refresh ${s().settings.refreshSec}s`;
  el.className = `feed ${state === 'ok' ? (live ? 'live' : 'delayed') : state}`;
  el.textContent = label;
  el.title = live ? 'Real-time via Binance websocket' : 'Yahoo Finance via CORS proxy. Exchange data may be delayed (typically 15 min for stocks).';
}

// ------------------------------------------------------------------ toolbar UI
function renderSymbolButton() {
  const r = resolve(s().symbol);
  const b = $('#sym-btn');
  b.innerHTML = '';
  b.append(h('span', { class: 'sb-icon', html: ICONS.search }), h('span', { class: 'sb-text' }, r.display));
}

function renderIntervals() {
  const box = $('#intervals');
  box.innerHTML = '';
  const favs = s().favIntervals.filter(i => INTERVALS[i]);
  const order = Object.keys(INTERVALS);
  favs.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!favs.includes(s().interval)) favs.push(s().interval);
  for (const iv of favs) {
    box.append(h('button', { class: `tbtn iv${iv === s().interval ? ' active' : ''}`, onclick: () => setInterval_(iv) }, iv));
  }
  box.append(h('button', { class: 'ibtn sm', title: 'All intervals', html: ICONS.chevDown, onclick: e => {
    menu(e.currentTarget, [
      { header: 'Intervals (★ = show in toolbar)' },
      ...order.map(iv => ({
        label: INTERVALS[iv].label, active: iv === s().interval, onClick: () => setInterval_(iv),
        right: h('span', { class: `fav${s().favIntervals.includes(iv) ? ' on' : ''}`, html: ICONS.star, onclick: ev => {
          ev.stopPropagation();
          const f = s().favIntervals;
          s().favIntervals = f.includes(iv) ? f.filter(x => x !== iv) : [...f, iv];
          store.save();
          ev.currentTarget.classList.toggle('on');
          renderIntervals();
        } }),
      })),
    ]);
  } }));
}

function renderChartTypeButton() {
  const t = s().chartType;
  $('#type-btn').innerHTML = ICONS[t === 'hollow' || t === 'heikin' ? 'candles' : t] || ICONS.candles;
}

function openChartTypeMenu(anchor) {
  menu(anchor, Object.entries(CHART_TYPES).map(([k, label]) => ({
    label, icon: k === 'hollow' || k === 'heikin' ? 'candles' : k, active: s().chartType === k,
    onClick: () => { s().chartType = k; store.save(); cv.setChartType(k); renderChartTypeButton(); },
  })));
}

function saveIndicators() {
  s().indicators = cv.indicators;
  store.save();
}

function onIndicatorAction(action, inst) {
  const list = cv.indicators;
  if (action === 'remove') cv.setIndicators(list.filter(x => x !== inst));
  else if (action === 'toggle') { inst.hidden = !inst.hidden; cv.setIndicators(list); }
  else if (action === 'settings') {
    indicatorSettings(inst,
      cfg => { Object.assign(inst, cfg); cv.setIndicators(list); saveIndicators(); },
      cfg => {
        s().indicatorDefaults = { ...(s().indicatorDefaults || {}), [inst.type]: cfg };
        store.save();
        toast(`Saved as default for new ${INDICATORS[inst.type].short}`, 'ok');
      });
    return;
  }
  saveIndicators();
}

function addIndicator(type) {
  const saved = s().indicatorDefaults?.[type];
  const inst = { params: {}, colors: {}, styles: {}, visibility: {}, ...(saved ? JSON.parse(JSON.stringify(saved)) : {}), id: uid(), type, hidden: false };
  cv.setIndicators([...cv.indicators, inst]);
  saveIndicators();
  toast(`Added ${INDICATORS[type].name}`, 'ok', 1500);
}

function renderTools() {
  const nav = $('#tools');
  nav.innerHTML = '';
  const btn = (key, title, onclick, cls = '') => h('button', { class: `ibtn tool ${cls}`, dataset: { tool: key }, title, html: ICONS[key], onclick });
  nav.append(btn('cursor', 'Cursor (Esc)', () => cv.drawings.setTool(null)));
  for (const [key, t] of Object.entries(TOOLS)) nav.append(btn(key, t.label, () => cv.drawings.setTool(cv.drawings.tool === key ? null : key)));
  nav.append(h('span', { class: 'tools-sep' }));
  const mag = btn('magnet', 'Magnet: snap to OHLC', () => { cv.drawings.magnet = !cv.drawings.magnet; mag.classList.toggle('active', cv.drawings.magnet); });
  const hide = btn('eye', 'Hide/show drawings', () => {
    cv.drawings.hidden = !cv.drawings.hidden;
    hide.innerHTML = ICONS[cv.drawings.hidden ? 'eyeOff' : 'eye'];
    hide.classList.toggle('active', cv.drawings.hidden);
    cv.drawings.update();
  });
  const del = btn('trash', 'Remove all drawings on this symbol', async () => {
    if (!cv.drawings.items.length) return;
    if (await confirm('Remove drawings', `Remove all ${cv.drawings.items.length} drawings on ${resolve(s().symbol).display}?`, { okText: 'Remove', danger: true })) cv.drawings.clear();
  });
  nav.append(mag, hide, del);
  const mark = tool => nav.querySelectorAll('.tool').forEach(b => {
    const k = b.dataset.tool;
    if (k in TOOLS || k === 'cursor') b.classList.toggle('active', tool ? k === tool : k === 'cursor');
  });
  cv.drawings.onToolChange = tool => { mark(tool); if (tool && isMobile()) document.body.classList.remove('tools-open'); };
  mark(null);
}

const RANGES = [['1D', '1m', 1], ['5D', '5m', 5], ['1M', '30m', 30], ['3M', '1h', 91], ['6M', '4h', 182], ['YTD', '1D', 'ytd'], ['1Y', '1D', 365], ['5Y', '1W', 1826], ['All', null, 'all']];
function renderRanges() {
  const box = $('#ranges');
  for (const [label, iv, days] of RANGES) {
    box.append(h('button', { class: 'bbtn', onclick: async () => {
      if (iv && iv !== s().interval) await setInterval_(iv);
      if (days === 'all') cv.fit(); else cv.setVisibleDays(days);
    } }, label));
  }
}

function renderStrip() {
  const strip = $('#strip');
  strip.append(
    h('button', { class: 'ibtn active', id: 'strip-watch', title: 'Watchlist', html: ICONS.list, onclick: toggleWatch }),
    h('button', { class: 'ibtn', title: 'Settings & sync', html: ICONS.gear, onclick: openSettings }),
    h('span', { class: 'grow' }),
    h('button', { class: 'ibtn', title: 'Help & shortcuts', html: ICONS.help, onclick: openHelp }));
}

function toggleWatch() {
  if (isMobile()) { document.body.classList.toggle('watch-open'); return; }
  s().ui.watchOpen = !s().ui.watchOpen;
  store.save(false);
  applyWatchLayout();
}

function applyWatchLayout() {
  const open = s().ui.watchOpen;
  document.body.classList.toggle('watch-closed', !open);
  $('#watch').style.width = `${s().ui.watchWidth}px`;
  $('#details').style.height = s().ui.detailsOpen ? `${s().ui.detailsHeight}px` : '';
  $('#strip-watch')?.classList.toggle('active', open);
}

function setupResizers() {
  const drag = (el, onMove) => el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const move = ev => onMove(ev);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); store.save(false); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  drag($('#watch-resizer'), e => {
    const strip = $('#strip').offsetWidth;
    s().ui.watchWidth = Math.max(220, Math.min(700, window.innerWidth - e.clientX - strip));
    $('#watch').style.width = `${s().ui.watchWidth}px`;
  });
  drag($('#details-split'), e => {
    const r = $('#watch').getBoundingClientRect();
    s().ui.detailsHeight = Math.max(80, Math.min(r.height - 120, r.bottom - e.clientY));
    s().ui.detailsOpen = true;
    $('#details').style.height = `${s().ui.detailsHeight}px`;
  });
}

function screenshot() {
  const canvas = cv.screenshot();
  canvas.toBlob(blob => {
    const a = h('a', { href: URL.createObjectURL(blob), download: `${resolve(s().symbol).display}_${s().interval}_${new Date().toISOString().slice(0, 10)}.png` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
}

function applyTheme() {
  const t = s().settings.theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#ffffff' : '#131722';
  cv.applyTheme(t);
}

// ------------------------------------------------------------------ settings / help
function openSettings() {
  const st = s().settings;
  const theme = h('select', { class: 'input' }, h('option', { value: 'dark', selected: st.theme === 'dark' }, 'Dark'), h('option', { value: 'light', selected: st.theme === 'light' }, 'Light'));
  const proxy = h('input', { class: 'input', placeholder: 'built-in: somethingview-proxy.itgeeksg.workers.dev', value: st.proxy });
  const refresh = h('input', { class: 'input', type: 'number', min: 10, value: st.refreshSec });
  const token = h('input', { class: 'input', type: 'password', placeholder: 'GitHub token with “gist” scope', value: st.gistToken, autocomplete: 'off' });
  const gistId = h('input', { class: 'input', placeholder: 'auto-detected / created', value: st.gistId });
  const auto = h('input', { type: 'checkbox', checked: st.autoSync });
  const syncMsg = h('div', { class: 'muted small' });

  const apply = () => {
    st.theme = theme.value;
    st.proxy = proxy.value.trim();
    st.refreshSec = Math.max(10, +refresh.value || 30);
    st.gistToken = token.value.trim();
    st.gistId = gistId.value.trim();
    st.autoSync = auto.checked;
    store.save(false);
    applyTheme();
  };
  const testProxy = async () => {
    apply();
    syncMsg.textContent = '';
    const out = $('.proxy-test', m.box);
    out.textContent = 'Testing…';
    try {
      const { bars } = await loadBars(resolve('SPX'), '1D', { range: '5d' });
      out.textContent = `OK — got ${bars.length} S&P 500 bars`;
      out.className = 'proxy-test up';
    } catch (e) {
      out.textContent = e.message;
      out.className = 'proxy-test down';
    }
  };
  const doSync = async dir => {
    apply();
    if (!st.gistToken) { syncMsg.textContent = 'Enter a token first.'; return; }
    syncMsg.textContent = dir === 'push' ? 'Uploading…' : 'Downloading…';
    try {
      if (dir === 'push') {
        const id = await sync.push();
        gistId.value = id;
        syncMsg.textContent = 'Uploaded to your private gist.';
      } else {
        const got = await sync.pull({ force: true });
        if (got) { toast('Loaded synced data', 'ok'); setTimeout(() => location.reload(), 500); } else syncMsg.textContent = 'No synced data found yet — push first.';
      }
    } catch (e) {
      syncMsg.textContent = e.message;
    }
  };

  const body = h('div', { class: 'settings' },
    h('section', {},
      h('h4', {}, 'Appearance'),
      h('div', { class: 'form grid2' }, h('label', {}, 'Theme'), theme)),
    h('section', {},
      h('h4', {}, 'Stock / index / FX data'),
      h('p', { class: 'muted small', html: 'Crypto <b>USDT</b> pairs stream straight from Binance. Everything else comes from Yahoo Finance through your Cloudflare Worker proxy (built in). Leave the field empty to use it; enter a different proxy URL only if you deploy another one.' }),
      h('div', { class: 'form grid2' },
        h('label', {}, 'Proxy URL'), proxy,
        h('label', {}, 'Refresh (sec)'), refresh),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: testProxy }, 'Test data connection'), h('span', { class: 'proxy-test' }))),
    h('section', {},
      h('h4', {}, 'Cloud sync (use your lists on every device)'),
      h('p', { class: 'muted small', html: 'Stores your watchlists, indicators and drawings in a <b>private GitHub Gist</b>. Create a token at <a href="https://github.com/settings/tokens/new?scopes=gist&description=SomethingView%20sync" target="_blank" rel="noopener">github.com/settings/tokens</a> with only the <code>gist</code> scope, and enter the same token on each device. The token is kept only in this browser.' }),
      h('div', { class: 'form grid2' },
        h('label', {}, 'GitHub token'), token,
        h('label', {}, 'Gist ID'), gistId,
        h('label', {}, 'Auto-sync'), h('label', { class: 'check' }, auto, ' Upload changes automatically and pull on open')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => doSync('push') }, 'Push now'),
        h('button', { class: 'btn', onclick: () => doSync('pull') }, 'Pull now')),
      syncMsg),
    h('section', {},
      h('h4', {}, 'Backup'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => download(`somethingview-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportData(), null, 1), 'application/json') }, 'Export all'),
        h('button', { class: 'btn', onclick: async () => {
          const f = await pickFile('.json,application/json');
          if (!f) return;
          try { store.importData(JSON.parse(f.text)); location.reload(); } catch (e) { toast(e.message, 'error'); }
        } }, 'Import…'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (await confirm('Reset everything', 'Delete all lists, drawings and settings on this device?', { okText: 'Reset', danger: true })) { store.reset(); location.reload(); }
        } }, 'Reset'))));

  const m = modal({ title: 'Settings', cls: 'settings-modal', body,
    footer: [h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => { apply(); m.close(); refreshFeed(); loadChart(); updateSyncDot(); } }, 'Save')] });
}

function openHelp() {
  const k = (keys, what) => h('div', { class: 'kb' }, h('span', {}, ...keys.map(x => h('kbd', {}, x))), h('span', {}, what));
  modal({ title: 'Help', cls: 'small', body: h('div', { class: 'help' },
    h('h4', {}, 'Keyboard'),
    k(['A–Z'], 'Start typing anywhere to search a symbol'),
    k(['↑', '↓'], 'Previous / next symbol in watchlist'),
    k(['Shift', 'W'], 'Open watchlists'),
    k(['Alt', 'T'], 'Trend line'), k(['Alt', 'H'], 'Horizontal line'), k(['Alt', 'V'], 'Vertical line'), k(['Alt', 'F'], 'Fib retracement'),
    k(['Del'], 'Delete selected drawing'),
    k(['Esc'], 'Cancel drawing / deselect'),
    h('h4', {}, 'Symbols'),
    h('p', { class: 'muted small', html:
      '<b>BTCUSDT, ETHUSDT…</b> or <b>BINANCE:XXX</b> use Binance (real-time).<br>' +
      '<b>BTCUSD, ETHBTC, BTCEUR</b> use Yahoo crypto (longer history).<br>' +
      '<b>SPX, NDX, DJI, HSI, NI225, KOSPI, STI, 000300, DXY, US10Y</b> are index aliases.<br>' +
      '<b>ES1!, NQ1!, GC1!</b> are continuous futures; <b>XAUUSD, SILVER, USOIL</b> commodities.<br>' +
      '<b>BTCSGD, BTCMYR…</b> are calculated (BTCUSD × USDSGD). Make your own: <b>BTCUSD/XAUUSD</b>, <b>ETHUSDT*USDSGD</b>.<br>' +
      '<b>USDSGD, EURUSD…</b> FX pairs. Any Yahoo ticker works too: <b>AAPL, D05.SI, 0700.HK, 7203.T</b>.<br>' +
      'TradingView exports (<b>EXCHANGE:SYMBOL</b>, <b>###Section</b>) can be uploaded as lists.' }),
    h('h4', {}, 'Drawings'),
    h('p', { class: 'muted small' }, 'Pick a tool on the left, then click-click (or drag) on the chart. Click a drawing to select it; drag its handles to edit. Double-click text or vertical lines to edit labels. Drawings are saved per symbol.'),
  ) });
}

function updateSyncDot() {
  $('#sync-dot').classList.toggle('hidden', !sync.syncEnabled() || !s().settings.autoSync);
}

// ------------------------------------------------------------------ keyboard
function setupKeys() {
  document.addEventListener('keydown', e => {
    if (isTyping(e) || document.querySelector('.overlay')) return;
    if (e.key === 'Escape') { cv.drawings.draft = null; cv.drawings.setTool(null); cv.drawings.selected = null; cv.drawings.update(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && cv.drawings.selected) { e.preventDefault(); cv.drawings.remove(cv.drawings.selected); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const map = { t: 'trend', h: 'hline', v: 'vline', f: 'fib', r: 'rect' };
      const tool = map[e.key.toLowerCase()] || map[e.code?.replace('Key', '').toLowerCase()];
      if (tool) { e.preventDefault(); cv.drawings.setTool(tool); }
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (e.shiftKey && e.key.toLowerCase() === 'w') { e.preventDefault(); wl.openListDialog(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); wl.step(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (/^[a-z0-9^]$/i.test(e.key)) {
      e.preventDefault();
      openSymbolSearch(e.key);
    }
  });
}

function openSymbolSearch(initial = '') {
  symbolSearch({ initial, onPick: k => setSymbol(k) });
}

// ------------------------------------------------------------------ list import via share link
async function handleHashImport() {
  const m = location.hash.match(/^#list=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const json = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
    if (!Array.isArray(json.i)) throw new Error('bad link');
    const n = json.i.filter(x => !x.startsWith('###')).length;
    if (await confirm('Import shared list', `Add the list “${json.n}” (${n} symbols) to your watchlists?`, { okText: 'Import' })) {
      wl.createList(json.n || 'Shared list', json.i);
      refreshFeed();
    }
  } catch {
    toast('Invalid share link', 'error');
  }
}

// ------------------------------------------------------------------ boot
async function init() {
  if (sync.syncEnabled() && s().settings.autoSync) {
    try {
      await Promise.race([sync.pull(), new Promise(r => setTimeout(r, 5000))]);
    } catch (e) { console.warn('sync pull failed', e); }
  }
  if (!Array.isArray(s().indicators)) s().indicators = DEFAULT_INDICATORS();

  cv = new ChartView($('#chart-wrap'));
  cv.chartType = s().chartType;
  cv.overlaysCollapsed = isMobile();
  cv.logScale = s().logScale;
  cv.indicators = s().indicators.filter(x => INDICATORS[x.type]);
  cv.onIndicatorAction = onIndicatorAction;
  cv.onNeedOlder = loadOlderBars;
  cv.drawings.onChange = items => {
    const key = resolve(s().symbol).key;
    if (items.length) s().drawings[key] = items; else delete s().drawings[key];
    store.save();
  };
  cv.drawings.onEditText = (initial, type) => prompt(type === 'text' ? 'Text' : 'Label', { value: initial, multiline: type === 'text', placeholder: type === 'vline' ? 'e.g. 2024 Halving' : '' });
  applyTheme();

  details = new Details($('#details'));
  wl = new Watchlist($('#wl'), {
    onSelect: k => setSymbol(k),
    onChange: () => refreshFeed(),
    getCurrent: () => s().symbol,
  });
  feed = new QuoteFeed(sym => { wl.updateQuotes(sym); details.render(); updateTitle(); });

  // toolbar
  $('#tools-toggle').innerHTML = ICONS.pencilRuler;
  $('#tools-toggle').onclick = () => document.body.classList.toggle('tools-open');
  $('#sym-btn').onclick = () => openSymbolSearch();
  $('#add-to-list').innerHTML = ICONS.plus;
  $('#add-to-list').onclick = () => {
    if (wl.add(s().symbol)) toast(`Added ${resolve(s().symbol).display} to ${wl.list.name}`, 'ok'); else toast('Already in this list');
  };
  $('#type-btn').onclick = e => openChartTypeMenu(e.currentTarget);
  $('#ind-btn').innerHTML = `${ICONS.indicators}<span>Indicators</span>`;
  $('#ind-btn').onclick = () => indicatorPicker(addIndicator);
  $('#shot-btn').innerHTML = ICONS.camera;
  $('#shot-btn').onclick = screenshot;
  $('#full-btn').innerHTML = ICONS.fullscreen;
  $('#full-btn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  $('#settings-btn').innerHTML = ICONS.gear;
  $('#settings-btn').onclick = openSettings;
  $('#watch-toggle').innerHTML = ICONS.panel;
  $('#watch-toggle').onclick = toggleWatch;
  $('#log-btn').classList.toggle('active', s().logScale);
  $('#log-btn').onclick = () => {
    s().logScale = !s().logScale;
    store.save();
    cv.setLogScale(s().logScale);
    $('#log-btn').classList.toggle('active', s().logScale);
  };
  $('#auto-btn').onclick = () => cv.autoScale();
  $('#details-split').ondblclick = () => { s().ui.detailsOpen = !s().ui.detailsOpen; store.save(false); applyWatchLayout(); };

  renderSymbolButton();
  renderIntervals();
  renderChartTypeButton();
  renderTools();
  renderRanges();
  renderStrip();
  applyWatchLayout();
  setupResizers();
  setupKeys();
  updateSyncDot();

  const clock = () => {
    const d = new Date();
    const off = -d.getTimezoneOffset() / 60;
    $('#clock').textContent = `${d.toLocaleTimeString('en-GB')} UTC${off >= 0 ? '+' : ''}${off}`;
  };
  clock();
  setInterval(clock, 1000);

  window.sv = { cv, wl, store }; // handy for debugging from the console
  wl.render();
  refreshFeed();
  await loadChart();

  sync.onStatus((st, msg) => {
    const dot = $('#sync-dot');
    dot.className = `sync-${st}`;
    dot.title = st === 'error' ? `Sync failed: ${msg}` : st === 'syncing' ? 'Syncing…' : 'Synced to GitHub Gist';
  });
  sync.startAutoSync();
  handleHashImport();
}

init();
