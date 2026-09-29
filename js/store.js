import { uid } from './util.js';

const KEY = 'somethingview:v1';
const listeners = {};

function defaultLists() {
  const mk = (name, items) => ({ id: uid(), name, items });
  const lists = [
    mk('Crypto', [
      '###Bitcoin', 'BTCUSD', 'BINANCE:BTCUSDT', 'BINANCE:BTCFDUSD', 'BTCEUR',
      '###Alts', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:TONUSDT', 'BINANCE:HYPEUSDT', 'BINANCE:XMRUSDT', 'BINANCE:BCHUSDT', 'ETHBTC',
      '###Macro', 'DJI', 'NDX', 'NQ1!', 'SPX', 'ES1!', 'XAUUSD', 'SILVER', 'DXY',
    ]),
    mk('Else', [
      'STI', 'DJI', 'SPX', 'NDX', 'HSI', 'KOSPI', 'NI225', '000300',
      '###Stocks', 'BLK', 'MSTR', 'COIN',
      '###Assets', 'BTCUSD', 'XAUUSD',
      '###FX', 'USDSGD', 'USDCNY', 'CHFSGD', 'SGDAUD', 'SGDMYR', 'SGDTHB',
    ]),
    mk('Bitcoin Companies', ['MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK', 'HUT', 'IBIT', 'FBTC', '3350.T']),
    mk('Singapore', ['STI', 'D05.SI', 'O39.SI', 'U11.SI', 'Z74.SI', 'C6L.SI', 'S68.SI', 'USDSGD']),
  ];
  return lists;
}

export const DEFAULT_INDICATORS = () => [
  { id: uid(), type: 'VOL', params: {}, colors: {}, hidden: false },
  { id: uid(), type: 'FIBB', params: {}, colors: {}, hidden: false },
  { id: uid(), type: 'MACD', params: {}, colors: {}, hidden: false },
  { id: uid(), type: 'SQZMOM', params: {}, colors: {}, hidden: false },
];

function defaults() {
  const lists = defaultLists();
  return {
    symbol: 'BINANCE:BTCUSDT',
    interval: '1D',
    chartType: 'candles',
    logScale: false,
    indicators: DEFAULT_INDICATORS(),
    lists: Object.fromEntries(lists.map(l => [l.id, l])),
    listOrder: lists.map(l => l.id),
    activeList: lists[0].id,
    recentLists: lists.map(l => l.id),
    collapsed: {},
    drawings: {},
    favIntervals: ['5m', '1h', '4h', '1D', '1W'],
    ui: { watchWidth: 320, watchOpen: true, detailsOpen: true, detailsHeight: 260 },
    settings: {
      proxy: '',
      refreshSec: 30,
      theme: 'dark',
      syncKey: '',
    },
    updated: Date.now(),
  };
}

function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return {
      ...d, ...s,
      ui: { ...d.ui, ...(s.ui || {}) },
      settings: { ...d.settings, ...(s.settings || {}) },
    };
  } catch {
    return d;
  }
}

let saveTimer;
export const store = {
  s: load(),
  on(ev, fn) { (listeners[ev] ||= []).push(fn); },
  emit(ev, data) { (listeners[ev] || []).forEach(fn => fn(data)); },
  // `synced` = the change should be pushed to cloud sync (content change, not UI state)
  save(synced = true) {
    if (synced) this.s.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* storage full or blocked */ }
    }, 250);
    if (synced) this.emit('changed');
  },
  flush() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* ignore */ }
  },
  // The portion of state that is synced / backed up (never includes the token)
  exportData() {
    const { settings, ...rest } = this.s;
    const { gistToken, syncKey, ...safeSettings } = settings;
    return { ...rest, settings: safeSettings, app: 'somethingview', version: 1 };
  },
  importData(data) {
    if (!data || data.app !== 'somethingview') throw new Error('Not a SomethingView backup');
    const keep = { syncKey: this.s.settings.syncKey };
    const d = defaults();
    const { app, version, ...rest } = data;
    this.s = { ...d, ...rest, ui: { ...d.ui, ...(rest.ui || {}) }, settings: { ...d.settings, ...(rest.settings || {}), ...keep } };
    // An imported backup replaces the account's synced copy too
    this.s.accountSynced = true;
    this.s.syncUpdated = Date.now();
    this.flush();
  },
  reset() {
    const keep = this.s.settings;
    this.s = defaults();
    this.s.settings.syncKey = keep.syncKey;
    // A reset replaces the account's synced copy too (instead of being undone by it)
    this.s.accountSynced = true;
    this.s.syncUpdated = Date.now();
    this.flush();
  },
};

window.addEventListener('beforeunload', () => store.flush());
