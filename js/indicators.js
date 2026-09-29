// Indicator math (TradingView/Pine-compatible where it matters) + registry.
const N = len => new Array(len).fill(null);

export function source(bars, s = 'close') {
  switch (s) {
    case 'open': return bars.map(b => b.open);
    case 'high': return bars.map(b => b.high);
    case 'low': return bars.map(b => b.low);
    case 'hl2': return bars.map(b => (b.high + b.low) / 2);
    case 'hlc3': return bars.map(b => (b.high + b.low + b.close) / 3);
    case 'ohlc4': return bars.map(b => (b.open + b.high + b.low + b.close) / 4);
    default: return bars.map(b => b.close);
  }
}

export function sma(a, n) {
  const o = N(a.length);
  let s = 0, c = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] != null) { s += a[i]; c++; }
    if (i >= n && a[i - n] != null) { s -= a[i - n]; c--; }
    if (i >= n - 1 && c === n) o[i] = s / n;
  }
  return o;
}

// Pine ta.ema: seeded with the SMA of the first `n` values
export function ema(a, n, alpha = 2 / (n + 1)) {
  const o = N(a.length);
  let prev = null, s = 0, c = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v == null) continue;
    if (prev == null) {
      s += v; c++;
      if (c === n) { prev = s / n; o[i] = prev; }
    } else {
      prev = alpha * v + (1 - alpha) * prev;
      o[i] = prev;
    }
  }
  return o;
}

export const rma = (a, n) => ema(a, n, 1 / n);

export function wma(a, n) {
  const o = N(a.length);
  const norm = (n * (n + 1)) / 2;
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < n; j++) {
      const v = a[i - n + 1 + j];
      if (v == null) { ok = false; break; }
      s += v * (j + 1);
    }
    if (ok) o[i] = s / norm;
  }
  return o;
}

export function stdev(a, n) {
  const o = N(a.length);
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, ok = true;
    for (let j = i - n + 1; j <= i; j++) { if (a[j] == null) { ok = false; break; } s += a[j]; }
    if (!ok) continue;
    const m = s / n;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (a[j] - m) ** 2;
    o[i] = Math.sqrt(v / n);
  }
  return o;
}

export function highest(a, n) {
  const o = N(a.length);
  for (let i = n - 1; i < a.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) if (a[j] != null && a[j] > m) m = a[j];
    o[i] = m === -Infinity ? null : m;
  }
  return o;
}

export function lowest(a, n) {
  const o = N(a.length);
  for (let i = n - 1; i < a.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) if (a[j] != null && a[j] < m) m = a[j];
    o[i] = m === Infinity ? null : m;
  }
  return o;
}

// Pine ta.linreg(src, n, 0)
export function linreg(a, n) {
  const o = N(a.length);
  const sx = (n * (n - 1)) / 2;
  const sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  for (let i = n - 1; i < a.length; i++) {
    let sy = 0, sxy = 0, ok = true;
    for (let j = 0; j < n; j++) {
      const v = a[i - n + 1 + j];
      if (v == null) { ok = false; break; }
      sy += v; sxy += j * v;
    }
    if (!ok) continue;
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const icpt = (sy - slope * sx) / n;
    o[i] = icpt + slope * (n - 1);
  }
  return o;
}

export function trueRange(bars) {
  return bars.map((b, i) => (i === 0 ? b.high - b.low
    : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
}

const zip = (a, b, f) => a.map((v, i) => (v == null || b[i] == null ? null : f(v, b[i])));

export function rsi(a, n) {
  const up = N(a.length), dn = N(a.length);
  for (let i = 1; i < a.length; i++) {
    if (a[i] == null || a[i - 1] == null) continue;
    const d = a[i] - a[i - 1];
    up[i] = Math.max(d, 0);
    dn[i] = Math.max(-d, 0);
  }
  const u = rma(up, n), d = rma(dn, n);
  return u.map((v, i) => (v == null || d[i] == null ? null : d[i] === 0 ? 100 : v === 0 ? 0 : 100 - 100 / (1 + v / d[i])));
}

function stoch(close, high, low, n) {
  const hh = highest(high, n), ll = lowest(low, n);
  return close.map((c, i) => (c == null || hh[i] == null || ll[i] == null ? null
    : hh[i] === ll[i] ? 0 : (100 * (c - ll[i])) / (hh[i] - ll[i])));
}

export function heikinAshi(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), volume: b.volume });
  }
  return out;
}

// ---------------------------------------------------------------- registry
const SRC = { key: 'source', label: 'Source', type: 'select', def: 'close', options: ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'] };
const len = (def, label = 'Length') => ({ key: 'length', label, type: 'int', def, min: 1 });

const UP = '#26a69a', DOWN = '#ef5350';

// Each definition:
//  overlay: draws on the price pane; otherwise gets its own pane
//  plots:   [{ key, label, type: 'line'|'histogram'|'dots', color, width, style }]
//  calc(bars, p) -> { plotKey: values[] | { values, colors } }
export const INDICATORS = {
  VOL: {
    name: 'Volume', short: 'Vol', overlay: true, volume: true, noArgs: true,
    params: [{ key: 'maLength', label: 'MA length (0 = off)', type: 'int', def: 0, min: 0 }],
    plots: [{ key: 'vol', label: 'Volume', type: 'histogram', color: UP }, { key: 'ma', label: 'MA', type: 'line', color: '#2962ff', width: 1 }],
    calc(bars, p) {
      const v = bars.map(b => b.volume);
      return {
        vol: { values: v, colors: bars.map(b => (b.close >= b.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)')) },
        ma: p.maLength > 0 ? sma(v, p.maLength) : v.map(() => null),
      };
    },
  },
  SMA: {
    name: 'Moving Average (SMA)', short: 'SMA', overlay: true,
    params: [len(20), SRC],
    plots: [{ key: 'ma', label: 'SMA', type: 'line', color: '#2962ff', width: 2 }],
    calc: (bars, p) => ({ ma: sma(source(bars, p.source), p.length) }),
  },
  EMA: {
    name: 'Exponential Moving Average (EMA)', short: 'EMA', overlay: true,
    params: [len(21), SRC],
    plots: [{ key: 'ma', label: 'EMA', type: 'line', color: '#ff9800', width: 2 }],
    calc: (bars, p) => ({ ma: ema(source(bars, p.source), p.length) }),
  },
  WMA: {
    name: 'Weighted Moving Average (WMA)', short: 'WMA', overlay: true,
    params: [len(20), SRC],
    plots: [{ key: 'ma', label: 'WMA', type: 'line', color: '#e91e63', width: 2 }],
    calc: (bars, p) => ({ ma: wma(source(bars, p.source), p.length) }),
  },
  MA_RIBBON: {
    name: 'EMA Ribbon (20/50/100/200)', short: 'EMAs', overlay: true,
    params: [SRC],
    plots: [
      { key: 'e20', label: '20', type: 'line', color: '#f7525f', width: 1 },
      { key: 'e50', label: '50', type: 'line', color: '#ff9800', width: 1 },
      { key: 'e100', label: '100', type: 'line', color: '#2962ff', width: 1 },
      { key: 'e200', label: '200', type: 'line', color: '#9c27b0', width: 2 },
    ],
    calc(bars, p) {
      const s = source(bars, p.source);
      return { e20: ema(s, 20), e50: ema(s, 50), e100: ema(s, 100), e200: ema(s, 200) };
    },
  },
  BB: {
    name: 'Bollinger Bands', short: 'BB', overlay: true,
    params: [len(20), SRC, { key: 'mult', label: 'StdDev', type: 'float', def: 2, step: 0.1 }],
    plots: [
      { key: 'basis', label: 'Basis', type: 'line', color: '#ff6d00', width: 1 },
      { key: 'upper', label: 'Upper', type: 'line', color: '#2962ff', width: 1 },
      { key: 'lower', label: 'Lower', type: 'line', color: '#2962ff', width: 1 },
    ],
    calc(bars, p) {
      const s = source(bars, p.source);
      const b = sma(s, p.length), d = stdev(s, p.length);
      return { basis: b, upper: zip(b, d, (x, y) => x + p.mult * y), lower: zip(b, d, (x, y) => x - p.mult * y) };
    },
  },
  FIBB: {
    // Matches the TradingView "FiBB" with inputs Len / Fibonacci Ratio 1-3: SMA(close) ± ratio × ATR
    name: 'Fibonacci Bollinger Bands', short: 'FiBB', overlay: true,
    params: [
      { key: 'length', label: 'Len', type: 'int', def: 20, min: 1 },
      { key: 'r1', label: 'Fibonacci Ratio 1', type: 'float', def: 1.618, step: 0.001 },
      { key: 'r2', label: 'Fibonacci Ratio 2', type: 'float', def: 2.618, step: 0.001 },
      { key: 'r3', label: 'Fibonacci Ratio 3', type: 'float', def: 4.236, step: 0.001 },
    ],
    plots: [
      { key: 'u3', label: 'Upper 3', type: 'line', color: '#f23645', width: 1 },
      { key: 'u2', label: 'Upper 2', type: 'line', color: 'rgba(0,188,212,0.8)', width: 1 },
      { key: 'u1', label: 'Upper 1', type: 'line', color: 'rgba(0,188,212,0.8)', width: 1 },
      { key: 'l1', label: 'Lower 1', type: 'line', color: 'rgba(0,188,212,0.8)', width: 1 },
      { key: 'l2', label: 'Lower 2', type: 'line', color: 'rgba(0,188,212,0.8)', width: 1 },
      { key: 'l3', label: 'Lower 3', type: 'line', color: '#089981', width: 1 },
      { key: 'basis', label: 'Basis', type: 'line', color: '#e040fb', width: 2 },
    ],
    calc(bars, p) {
      const basis = sma(source(bars), p.length);
      const atr = rma(trueRange(bars), p.length);
      const band = (r, sign) => zip(basis, atr, (b, a) => b + sign * r * a);
      return { u3: band(p.r3, 1), u2: band(p.r2, 1), u1: band(p.r1, 1), l1: band(p.r1, -1), l2: band(p.r2, -1), l3: band(p.r3, -1), basis };
    },
  },
  FIBB_VWMA: {
    name: 'Fibonacci Bollinger Bands (VWMA / StdDev)', short: 'FiBB-V', overlay: true,
    params: [len(200), { ...SRC, def: 'hlc3' }, { key: 'mult', label: 'Multiplier', type: 'float', def: 3, step: 0.1 }],
    plots: [
      { key: 'basis', label: 'Basis', type: 'line', color: '#e040fb', width: 2 },
      ...[1, 2, 3, 4, 5].map(i => ({ key: `u${i}`, label: `U${i}`, type: 'line', color: 'rgba(66,110,255,0.55)', width: 1 })),
      { key: 'u6', label: 'U6', type: 'line', color: '#f23645', width: 2 },
      ...[1, 2, 3, 4, 5].map(i => ({ key: `l${i}`, label: `L${i}`, type: 'line', color: 'rgba(66,110,255,0.55)', width: 1 })),
      { key: 'l6', label: 'L6', type: 'line', color: '#089981', width: 2 },
    ],
    calc(bars, p) {
      const s = source(bars, p.source);
      const vol = bars.map(b => b.volume || 0);
      const hasVol = vol.some(v => v > 0);
      const basis = hasVol
        ? zip(sma(s.map((x, i) => x * vol[i]), p.length), sma(vol, p.length), (a, b) => (b ? a / b : null))
        : sma(s, p.length);
      const dev = stdev(s, p.length).map(d => (d == null ? null : d * p.mult));
      const out = { basis };
      [0.236, 0.382, 0.5, 0.618, 0.764, 1].forEach((f, i) => {
        out[`u${i + 1}`] = zip(basis, dev, (b, d) => b + f * d);
        out[`l${i + 1}`] = zip(basis, dev, (b, d) => b - f * d);
      });
      return out;
    },
  },
  SUPERTREND: {
    name: 'Supertrend', short: 'Supertrend', overlay: true,
    params: [{ key: 'atr', label: 'ATR length', type: 'int', def: 10, min: 1 }, { key: 'factor', label: 'Factor', type: 'float', def: 3, step: 0.1 }],
    plots: [{ key: 'up', label: 'Up', type: 'line', color: UP, width: 2 }, { key: 'dn', label: 'Down', type: 'line', color: DOWN, width: 2 }],
    calc(bars, p) {
      const atr = rma(trueRange(bars), p.atr);
      const up = N(bars.length), dn = N(bars.length);
      let pu = null, pl = null, pst = null, dir = 1;
      for (let i = 0; i < bars.length; i++) {
        if (atr[i] == null) continue;
        const src = (bars[i].high + bars[i].low) / 2;
        let ub = src + p.factor * atr[i], lb = src - p.factor * atr[i];
        const pc = i > 0 ? bars[i - 1].close : bars[i].close;
        if (pl != null) lb = lb > pl || pc < pl ? lb : pl;
        if (pu != null) ub = ub < pu || pc > pu ? ub : pu;
        if (pst == null) dir = 1;
        else if (pst === pu) dir = bars[i].close > ub ? -1 : 1;
        else dir = bars[i].close < lb ? 1 : -1;
        const st = dir === -1 ? lb : ub;
        if (dir === -1) up[i] = st; else dn[i] = st;
        pu = ub; pl = lb; pst = st;
      }
      return { up, dn };
    },
  },
  MACD: {
    name: 'MACD', short: 'MACD',
    params: [
      { key: 'fast', label: 'Fast length', type: 'int', def: 12, min: 1 },
      { key: 'slow', label: 'Slow length', type: 'int', def: 26, min: 1 },
      { key: 'signal', label: 'Signal smoothing', type: 'int', def: 9, min: 1 },
      SRC,
    ],
    plots: [
      { key: 'hist', label: 'Histogram', type: 'histogram', color: UP },
      { key: 'macd', label: 'MACD', type: 'line', color: '#2962ff', width: 2 },
      { key: 'signal', label: 'Signal', type: 'line', color: '#ff6d00', width: 2 },
    ],
    levels: [0],
    calc(bars, p) {
      const s = source(bars, p.source);
      const macd = zip(ema(s, p.fast), ema(s, p.slow), (a, b) => a - b);
      const signal = ema(macd, p.signal);
      const hist = zip(macd, signal, (a, b) => a - b);
      const colors = hist.map((v, i) => {
        const pv = hist[i - 1] ?? v;
        return v >= 0 ? (pv < v ? '#26a69a' : '#b2dfdb') : (pv < v ? '#ffcdd2' : '#ff5252');
      });
      return { hist: { values: hist, colors }, macd, signal };
    },
  },
  RSI: {
    name: 'Relative Strength Index', short: 'RSI',
    params: [len(14), SRC, { key: 'ma', label: 'MA length (0 = off)', type: 'int', def: 14, min: 0 }],
    plots: [{ key: 'rsi', label: 'RSI', type: 'line', color: '#7e57c2', width: 2 }, { key: 'ma', label: 'MA', type: 'line', color: '#f7c948', width: 1 }],
    levels: [70, 50, 30],
    calc(bars, p) {
      const r = rsi(source(bars, p.source), p.length);
      return { rsi: r, ma: p.ma > 0 ? sma(r, p.ma) : r.map(() => null) };
    },
  },
  STOCH: {
    name: 'Stochastic', short: 'Stoch',
    params: [
      { key: 'k', label: '%K length', type: 'int', def: 14, min: 1 },
      { key: 'smoothK', label: '%K smoothing', type: 'int', def: 1, min: 1 },
      { key: 'd', label: '%D smoothing', type: 'int', def: 3, min: 1 },
    ],
    plots: [{ key: 'k', label: '%K', type: 'line', color: '#2962ff', width: 2 }, { key: 'd', label: '%D', type: 'line', color: '#ff6d00', width: 2 }],
    levels: [80, 20],
    calc(bars, p) {
      const k = sma(stoch(source(bars), source(bars, 'high'), source(bars, 'low'), p.k), p.smoothK);
      return { k, d: sma(k, p.d) };
    },
  },
  STOCHRSI: {
    name: 'Stochastic RSI', short: 'Stoch RSI',
    params: [
      { key: 'k', label: 'K', type: 'int', def: 3, min: 1 },
      { key: 'd', label: 'D', type: 'int', def: 3, min: 1 },
      { key: 'rsi', label: 'RSI length', type: 'int', def: 14, min: 1 },
      { key: 'stoch', label: 'Stochastic length', type: 'int', def: 14, min: 1 },
      SRC,
    ],
    plots: [{ key: 'k', label: 'K', type: 'line', color: '#2962ff', width: 2 }, { key: 'd', label: 'D', type: 'line', color: '#ff6d00', width: 2 }],
    levels: [80, 20],
    calc(bars, p) {
      const r = rsi(source(bars, p.source), p.rsi);
      const k = sma(stoch(r, r, r, p.stoch), p.k);
      return { k, d: sma(k, p.d) };
    },
  },
  SQZMOM: {
    name: 'Squeeze Momentum [LazyBear]', short: 'SQZMOM_LB',
    params: [
      { key: 'bbLen', label: 'BB length', type: 'int', def: 20, min: 1 },
      { key: 'bbMult', label: 'BB mult', type: 'float', def: 2, step: 0.1 },
      { key: 'kcLen', label: 'KC length', type: 'int', def: 20, min: 1 },
      { key: 'kcMult', label: 'KC mult', type: 'float', def: 1.5, step: 0.1 },
      { key: 'useTR', label: 'Use TrueRange (KC)', type: 'bool', def: true },
    ],
    plots: [{ key: 'val', label: 'Momentum', type: 'histogram', color: '#00e676' }, { key: 'sqz', label: 'Squeeze', type: 'dots', color: '#787b86' }],
    calc(bars, p) {
      const close = source(bars), high = source(bars, 'high'), low = source(bars, 'low');
      // Faithful to LazyBear's original, which uses the KC multiplier for the BB deviation
      const basis = sma(close, p.bbLen), dev = stdev(close, p.bbLen).map(d => (d == null ? null : d * p.kcMult));
      const ma = sma(close, p.kcLen);
      const range = p.useTR ? trueRange(bars) : bars.map(b => b.high - b.low);
      const rangema = sma(range, p.kcLen);
      const hh = highest(high, p.kcLen), ll = lowest(low, p.kcLen);
      const delta = close.map((c, i) => (hh[i] == null || ma[i] == null ? null : c - ((hh[i] + ll[i]) / 2 + ma[i]) / 2));
      const val = linreg(delta, p.kcLen);
      const colors = val.map((v, i) => {
        const pv = val[i - 1] ?? 0;
        return v > 0 ? (v > pv ? '#00e676' : '#1b8a3a') : (v < pv ? '#ff1744' : '#8b1a1a');
      });
      const sqz = N(bars.length), scol = N(bars.length);
      for (let i = 0; i < bars.length; i++) {
        if (basis[i] == null || dev[i] == null || ma[i] == null || rangema[i] == null) continue;
        const ubb = basis[i] + dev[i], lbb = basis[i] - dev[i];
        const ukc = ma[i] + rangema[i] * p.kcMult, lkc = ma[i] - rangema[i] * p.kcMult;
        const on = lbb > lkc && ubb < ukc, off = lbb < lkc && ubb > ukc;
        sqz[i] = 0;
        scol[i] = on ? '#d1d4dc' : off ? '#434651' : '#2962ff';
      }
      return { val: { values: val, colors }, sqz: { values: sqz, colors: scol } };
    },
  },
  ATR: {
    name: 'Average True Range', short: 'ATR',
    params: [len(14)],
    plots: [{ key: 'atr', label: 'ATR', type: 'line', color: '#b71c1c', width: 2 }],
    calc: (bars, p) => ({ atr: rma(trueRange(bars), p.length) }),
  },
  OBV: {
    name: 'On Balance Volume', short: 'OBV',
    params: [],
    plots: [{ key: 'obv', label: 'OBV', type: 'line', color: '#2962ff', width: 2 }],
    calc(bars) {
      let o = 0;
      return { obv: bars.map((b, i) => (i === 0 ? 0 : (o += b.close > bars[i - 1].close ? b.volume : b.close < bars[i - 1].close ? -b.volume : 0))) };
    },
  },
  CCI: {
    name: 'Commodity Channel Index', short: 'CCI',
    params: [len(20), { ...SRC, def: 'hlc3' }],
    plots: [{ key: 'cci', label: 'CCI', type: 'line', color: '#2962ff', width: 2 }],
    levels: [100, 0, -100],
    calc(bars, p) {
      const s = source(bars, p.source), ma = sma(s, p.length);
      const out = N(bars.length);
      for (let i = p.length - 1; i < s.length; i++) {
        if (ma[i] == null) continue;
        let md = 0;
        for (let j = i - p.length + 1; j <= i; j++) md += Math.abs(s[j] - ma[i]);
        md /= p.length;
        out[i] = md === 0 ? 0 : (s[i] - ma[i]) / (0.015 * md);
      }
      return { cci: out };
    },
  },
  DMI: {
    name: 'ADX / DMI', short: 'DMI',
    params: [{ key: 'di', label: 'DI length', type: 'int', def: 14, min: 1 }, { key: 'adx', label: 'ADX smoothing', type: 'int', def: 14, min: 1 }],
    plots: [
      { key: 'adx', label: 'ADX', type: 'line', color: '#f50057', width: 2 },
      { key: 'plus', label: '+DI', type: 'line', color: '#2962ff', width: 1 },
      { key: 'minus', label: '−DI', type: 'line', color: '#ff6d00', width: 1 },
    ],
    calc(bars, p) {
      const pdm = N(bars.length), mdm = N(bars.length);
      for (let i = 1; i < bars.length; i++) {
        const up = bars[i].high - bars[i - 1].high, dn = bars[i - 1].low - bars[i].low;
        pdm[i] = up > dn && up > 0 ? up : 0;
        mdm[i] = dn > up && dn > 0 ? dn : 0;
      }
      const tr = rma(trueRange(bars).map((v, i) => (i === 0 ? null : v)), p.di);
      const plus = zip(rma(pdm, p.di), tr, (a, b) => (b ? (100 * a) / b : 0));
      const minus = zip(rma(mdm, p.di), tr, (a, b) => (b ? (100 * a) / b : 0));
      const dx = zip(plus, minus, (a, b) => (a + b === 0 ? 0 : Math.abs(a - b) / (a + b)));
      return { adx: rma(dx, p.adx).map(v => (v == null ? null : v * 100)), plus, minus };
    },
  },
  WPR: {
    name: 'Williams %R', short: '%R',
    params: [len(14)],
    plots: [{ key: 'r', label: '%R', type: 'line', color: '#7e57c2', width: 2 }],
    levels: [-20, -50, -80],
    calc(bars, p) {
      const hh = highest(source(bars, 'high'), p.length), ll = lowest(source(bars, 'low'), p.length);
      return { r: bars.map((b, i) => (hh[i] == null ? null : hh[i] === ll[i] ? 0 : (100 * (b.close - hh[i])) / (hh[i] - ll[i]))) };
    },
  },
  MFI: {
    name: 'Money Flow Index', short: 'MFI',
    params: [len(14)],
    plots: [{ key: 'mfi', label: 'MFI', type: 'line', color: '#7e57c2', width: 2 }],
    levels: [80, 20],
    calc(bars, p) {
      const tp = source(bars, 'hlc3');
      const pos = N(bars.length), neg = N(bars.length);
      for (let i = 1; i < bars.length; i++) {
        const mf = tp[i] * bars[i].volume;
        pos[i] = tp[i] > tp[i - 1] ? mf : 0;
        neg[i] = tp[i] < tp[i - 1] ? mf : 0;
      }
      const sp = sma(pos, p.length), sn = sma(neg, p.length);
      return { mfi: zip(sp, sn, (a, b) => (b === 0 ? 100 : 100 - 100 / (1 + a / b))) };
    },
  },
};

export function paramsWithDefaults(inst) {
  const def = INDICATORS[inst.type];
  const p = {};
  for (const x of def.params) p[x.key] = inst.params?.[x.key] ?? x.def;
  return p;
}

export function legendArgs(inst) {
  const def = INDICATORS[inst.type];
  if (def.noArgs) return '';
  const p = paramsWithDefaults(inst);
  return def.params.filter(x => x.type !== 'bool').map(x => p[x.key]).join(' ');
}

// ---------------------------------------------------------------- per-instance style & visibility
export const LINE_STYLES = [[0, 'Solid'], [2, 'Dashed'], [1, 'Dotted'], [3, 'Large dashed']];
export const PLOT_TYPES = [['line', 'Line'], ['step', 'Step line'], ['circles', 'Circles']];

export function parseColor(c = '#2962ff') {
  if (/^#[0-9a-f]{6}$/i.test(c)) return { hex: c.toLowerCase(), alpha: 1 };
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return { hex: '#2962ff', alpha: 1 };
  return { hex: '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join(''), alpha: m[4] != null ? +m[4] : 1 };
}

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return a >= 1 ? hex : `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${+a.toFixed(3)})`;
}

// Resolved look of one plot of an indicator instance (user overrides on top of the defaults)
export function plotStyle(inst, plot) {
  const st = inst.styles?.[plot.key] || {};
  const base = parseColor(inst.colors?.[plot.key] || plot.color);
  const opacity = st.opacity ?? Math.round(base.alpha * 100);
  return {
    hex: base.hex, opacity, color: rgba(base.hex, opacity / 100),
    width: st.width ?? plot.width ?? 1,
    lineStyle: st.lineStyle ?? 0,
    plotType: st.plotType ?? 'line',
    hidden: !!st.hidden,
  };
}

// Timeframe visibility, like TradingView's "Visibility" tab
export const VIS_UNITS = [['minutes', 'Minutes', 59], ['hours', 'Hours', 24], ['days', 'Days', 366], ['weeks', 'Weeks', 52], ['months', 'Months', 12]];
const UNIT_OF = { m: 'minutes', h: 'hours', D: 'days', W: 'weeks', M: 'months' };

export function visibleOn(inst, interval) {
  const m = String(interval).match(/^(\d+)([mhDWM])$/);
  if (!m) return true;
  const unit = UNIT_OF[m[2]], n = +m[1];
  const v = inst.visibility?.[unit];
  if (!v) return true;
  const max = VIS_UNITS.find(u => u[0] === unit)[2];
  return v.on !== false && n >= (v.min ?? 1) && n <= (v.max ?? max);
}
