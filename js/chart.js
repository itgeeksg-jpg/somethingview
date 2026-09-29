import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
  CrosshairMode, PriceScaleMode, LineStyle, LineType,
} from './lib/lightweight-charts.mjs';
import { INDICATORS, paramsWithDefaults, legendArgs, heikinAshi, plotStyle, visibleOn } from './indicators.js';
import { Drawings } from './drawings.js';
import { INTERVALS } from './data.js';
import { h, fmtPrice, fmtAuto, fmtVol, autoPrecision, escapeHtml } from './util.js';
import { ICONS } from './icons.js';

const UP = '#089981', DOWN = '#f23645';

export const THEMES = {
  dark: { bg: '#131722', text: '#b2b5be', grid: 'rgba(42,46,57,0.45)', border: '#2a2e39', sep: '#2a2e39', sepHover: 'rgba(41,98,255,0.4)', cross: '#787b86' },
  light: { bg: '#ffffff', text: '#131722', grid: 'rgba(224,227,235,0.7)', border: '#e0e3eb', sep: '#e0e3eb', sepHover: 'rgba(41,98,255,0.3)', cross: '#9598a1' },
};

export const CHART_TYPES = {
  candles: 'Candles', hollow: 'Hollow candles', bars: 'Bars', heikin: 'Heikin Ashi', line: 'Line', area: 'Area',
};

const indFormat = { type: 'custom', minMove: 1e-10, formatter: v => fmtAuto(v) };

export class ChartView {
  constructor(wrap) {
    this.wrap = wrap;
    this.chartEl = wrap.querySelector('#chart');
    this.layer = wrap.querySelector('#legend-layer');
    this.chart = createChart(this.chartEl, {
      autoSize: true,
      layout: { fontSize: 11, fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif', panes: { enableResize: true } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 6 },
      localization: { locale: 'en-US' },
    });
    this.bars = [];
    this.meta = {};
    this.precision = 2;
    this.chartType = 'candles';
    this.indicators = [];
    this.ind = [];
    this.main = null;
    this.interval = '1D';
    this.title = '';
    this.subtitle = '';
    this.logScale = false;
    this.overlaysCollapsed = false;
    this.onIndicatorAction = () => {};
    this.onNeedOlder = () => {};
    this.crossIdx = null;
    this._appliedLen = 0;

    this.drawings = new Drawings(this);
    this.chart.subscribeCrosshairMove(p => {
      this.crossIdx = p.logical != null && p.point ? Math.round(p.logical) : null;
      this.updateLegendValues();
    });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
      this.drawings.update();
      if (r && r.from < 30 && this.bars.length) this.onNeedOlder();
    });
    this.paneObserver = new ResizeObserver(() => this.positionLegends());
    this.paneObserver.observe(this.chartEl);
    this.onAutoScaleChange = () => {};
    this.setupFreeDrag();
    this.applyTheme('dark');
  }

  applyTheme(name) {
    const t = THEMES[name] || THEMES.dark;
    this.theme = t;
    this.chart.applyOptions({
      layout: { background: { color: t.bg }, textColor: t.text, panes: { separatorColor: t.sep, separatorHoverColor: t.sepHover } },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border },
      crosshair: { vertLine: { color: t.cross, labelBackgroundColor: '#363a45' }, horzLine: { color: t.cross, labelBackgroundColor: '#363a45' } },
    });
  }

  // ---------------------------------------------------------------- time <-> logical helpers (used by drawings)
  get barSec() { return INTERVALS[this.interval]?.sec || 86400; }

  timeToLogical(t) {
    const b = this.bars, n = b.length;
    if (!n) return 0;
    if (t <= b[0].time) return (t - b[0].time) / this.barSec;
    if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / this.barSec;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (b[m].time <= t) lo = m; else hi = m;
    }
    return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
  }

  logicalToTime(l) {
    const b = this.bars, n = b.length;
    if (!n) return 0;
    if (l <= 0) return b[0].time + l * this.barSec;
    if (l >= n - 1) return b[n - 1].time + (l - (n - 1)) * this.barSec;
    const i = Math.floor(l), f = l - i;
    return b[i].time + f * (b[i + 1].time - b[i].time);
  }

  // logicalToCoordinate only handles whole bar indexes, so interpolate between them
  timeToX(t) {
    const ts = this.chart.timeScale();
    const l = this.timeToLogical(t);
    const i = Math.floor(l);
    const x0 = ts.logicalToCoordinate(i);
    if (x0 == null || l === i) return x0;
    const x1 = ts.logicalToCoordinate(i + 1);
    return x1 == null ? x0 : x0 + (l - i) * (x1 - x0);
  }

  // ---------------------------------------------------------------- data
  setData({ bars, meta }, { title, subtitle, interval, reset = true } = {}) {
    this.bars = bars;
    this.meta = meta || {};
    if (interval) this.interval = interval;
    this.title = title ?? this.title;
    this.subtitle = subtitle ?? this.subtitle;
    this.precision = Math.min(8, Math.max(0, meta?.precision ?? (bars.length ? autoPrecision(bars[bars.length - 1].close) : 2)));
    this.rebuild(reset);
  }

  prepend(older) {
    if (!older?.length || !this.bars.length) return;
    const first = this.bars[0].time;
    const add = older.filter(b => b.time < first);
    if (!add.length) return;
    const ts = this.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    this.bars = add.concat(this.bars);
    this.setAllData();
    if (r) ts.setVisibleLogicalRange({ from: r.from + add.length, to: r.to + add.length });
  }

  // Swap in a longer history (keeps any newer live bars and the current view)
  replaceHistory(full) {
    if (!full?.length || !this.bars.length) return;
    const oldFirst = this.bars[0].time;
    const lastFull = full[full.length - 1].time;
    const merged = full.concat(this.bars.filter(b => b.time > lastFull));
    const shift = merged.findIndex(b => b.time >= oldFirst);
    if (shift < 0) return;
    const ts = this.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    this.bars = merged;
    this.setAllData();
    if (r) ts.setVisibleLogicalRange({ from: r.from + shift, to: r.to + shift });
  }

  updateBar(bar) {
    const n = this.bars.length;
    if (!n || !this.main) return;
    const last = this.bars[n - 1];
    if (bar.time < last.time) return;
    if (bar.time === last.time) this.bars[n - 1] = bar;
    else this.bars.push(bar);
    if (!this._livePending) {
      this._livePending = true;
      requestAnimationFrame(() => this.applyLive());
    }
  }

  applyLive() {
    this._livePending = false;
    const n = this.bars.length;
    if (n - this._appliedLen > 1) { this.setAllData(); return; }
    const pts = this.mainData();
    this.main.update(pts[n - 1]);
    for (const e of this.ind) {
      e.out = this.compute(e);
      for (const [key, s] of Object.entries(e.series)) s.update(this.point(e.out[key], n - 1, e.priceOverlay));
    }
    this._appliedLen = n;
    this.updateLegendValues();
  }

  mainData() {
    const src = this.chartType === 'heikin' ? heikinAshi(this.bars) : this.bars;
    if (this.chartType === 'line' || this.chartType === 'area') return src.map(b => ({ time: b.time, value: b.close }));
    return src.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
  }

  compute(e) {
    try {
      const raw = e.def.calc(this.bars, paramsWithDefaults(e.inst));
      const out = {};
      for (const [k, v] of Object.entries(raw)) out[k] = Array.isArray(v) ? { values: v } : v;
      return out;
    } catch (err) {
      console.error('indicator failed', e.inst.type, err);
      return {};
    }
  }

  // positiveOnly: price-pane overlays can't go <= 0 (breaks log scale, meaningless for prices)
  point(o, i, positiveOnly = false) {
    const time = this.bars[i].time;
    const v = o?.values?.[i];
    if (v == null || !isFinite(v) || (positiveOnly && v <= 0)) return { time };
    return o.colors?.[i] ? { time, value: v, color: o.colors[i] } : { time, value: v };
  }

  setAllData() {
    if (!this.main) return;
    this.main.setData(this.mainData());
    for (const e of this.ind) {
      e.out = this.compute(e);
      for (const [key, s] of Object.entries(e.series)) {
        const o = e.out[key];
        s.setData(this.bars.map((_, i) => this.point(o, i, e.priceOverlay)));
      }
    }
    this._appliedLen = this.bars.length;
    this.updateLegendValues();
    this.drawings.update();
  }

  // ---------------------------------------------------------------- series construction
  priceFormat() {
    const p = this.precision;
    return { type: 'custom', minMove: 1 / 10 ** p, formatter: v => fmtPrice(v, p) };
  }

  mainSeries() {
    const pf = this.priceFormat();
    const common = { priceFormat: pf, priceLineVisible: true };
    switch (this.chartType) {
      case 'bars': return this.chart.addSeries(BarSeries, { ...common, upColor: UP, downColor: DOWN, thinBars: false }, 0);
      case 'line': return this.chart.addSeries(LineSeries, { ...common, color: '#2962ff', lineWidth: 2 }, 0);
      case 'area': return this.chart.addSeries(AreaSeries, { ...common, lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.35)', bottomColor: 'rgba(41,98,255,0)', lineWidth: 2 }, 0);
      case 'hollow': return this.chart.addSeries(CandlestickSeries, { ...common, upColor: 'rgba(0,0,0,0)', downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN }, 0);
      default: return this.chart.addSeries(CandlestickSeries, { ...common, upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN }, 0);
    }
  }

  rebuild(reset = false) {
    const ts = this.chart.timeScale();
    const range = reset ? null : ts.getVisibleLogicalRange();
    if (this.main) this.chart.removeSeries(this.main);
    for (const e of this.ind) for (const s of Object.values(e.series)) this.chart.removeSeries(s);
    this.ind = [];
    this.main = this.mainSeries();
    this.drawings.attach(this.main);

    let pane = 1;
    for (const inst of this.indicators) {
      const def = INDICATORS[inst.type];
      if (!def || !visibleOn(inst, this.interval)) continue;
      const e = { inst, def, pane: def.overlay ? 0 : pane++, series: {}, priceOverlay: def.overlay && !def.volume };
      for (const plot of def.plots) {
        const st = plotStyle(inst, plot);
        const color = st.color;
        const base = { priceLineVisible: false, visible: !inst.hidden && !st.hidden, lastValueVisible: !def.overlay || def.plots.length <= 2 };
        let opts;
        if (def.volume) {
          opts = { ...base, priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false };
        } else {
          opts = { ...base, priceFormat: def.overlay ? this.priceFormat() : indFormat };
          // Keep price-pane overlays (e.g. wide Fib bands) from squashing the candles
          if (def.overlay) opts.autoscaleInfoProvider = () => null;
        }
        let s;
        if (plot.type === 'histogram') s = this.chart.addSeries(HistogramSeries, { ...opts, color }, e.pane);
        else if (plot.type === 'dots') s = this.chart.addSeries(LineSeries, { ...opts, color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5, lastValueVisible: false, crosshairMarkerVisible: false }, e.pane);
        else if (st.plotType === 'circles') s = this.chart.addSeries(LineSeries, { ...opts, color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1 + st.width, crosshairMarkerVisible: false }, e.pane);
        else s = this.chart.addSeries(LineSeries, { ...opts, color, lineWidth: st.width, lineStyle: st.lineStyle, lineType: st.plotType === 'step' ? LineType.WithSteps : LineType.Simple, crosshairMarkerVisible: false }, e.pane);
        e.series[plot.key] = s;
      }
      if (def.volume) e.series.vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      const first = Object.values(e.series)[0];
      for (const lv of def.levels || []) {
        first.createPriceLine({ price: lv, color: 'rgba(120,123,134,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
      }
      this.ind.push(e);
    }

    const panes = this.chart.panes();
    const subs = panes.length - 1;
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? (subs <= 1 ? 3 : subs <= 3 ? 2.2 : 2) : 1));
    this.applyLogScale();
    this.setAllData();
    if (reset) {
      ts.applyOptions({ barSpacing: this.bars.length < 120 ? 12 : 6 });
      ts.scrollToRealTime();
      this.autoScale(); // new symbol/timeframe: prices are in a different range
    } else if (range) {
      ts.setVisibleLogicalRange(range);
    }
    this.buildLegends();
  }

  setChartType(t) { this.chartType = t; this.rebuild(false); }

  setIndicators(list) { this.indicators = list; this.rebuild(false); }

  setLogScale(on) { this.logScale = on; this.applyLogScale(); }

  applyLogScale() {
    this.chart.priceScale('right', 0).applyOptions({ mode: this.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }

  autoScale() {
    this.chart.panes().forEach((_, i) => this.chart.priceScale('right', i).applyOptions({ autoScale: true }));
    this.onAutoScaleChange(true);
  }

  isAutoScale() {
    return this.chart.priceScale('right', 0).options().autoScale;
  }

  // TradingView-style dragging: dragging the chart up/down moves it vertically too, switching the
  // pane's price scale out of auto mode (the library only pans vertically when auto is already off).
  setupFreeDrag() {
    let d = null;
    const paneAt = (x, y) => {
      const panes = this.chart.panes();
      for (let i = 0; i < panes.length; i++) {
        const r = panes[i].getHTMLElement()?.getBoundingClientRect();
        if (r && y >= r.top && y < r.bottom && x >= r.left && x < r.left + this.chart.paneSize(i).width) return { i, r };
      }
      return null;
    };
    this.chartEl.addEventListener('pointerdown', e => {
      d = null;
      if (e.button !== 0 || this.drawings.tool || this.drawings.drag || !this.bars.length) return;
      const hit = paneAt(e.clientX, e.clientY);
      if (!hit) return;
      const ps = this.chart.priceScale('right', hit.i);
      // Already manual: the chart library pans vertically by itself
      if (!ps.options().autoScale) return;
      d = { ps, pane: hit.i, y0: e.clientY, x0: e.clientX, h: hit.r.height, engaged: false };
    }, true);
    window.addEventListener('pointermove', e => {
      if (!d || !e.buttons) return;
      const dy = e.clientY - d.y0;
      if (!d.engaged) {
        // Mostly-horizontal drags keep auto-scale, like TradingView
        if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(e.clientX - d.x0) * 0.35) return;
        const range = d.ps.getVisibleRange();
        if (!range) { d = null; return; }
        d.ps.applyOptions({ autoScale: false });
        d.range = range;
        d.y0 = e.clientY;
        d.log = d.ps.options().mode === PriceScaleMode.Logarithmic && range.from > 0;
        d.engaged = true;
        if (d.pane === 0) this.onAutoScaleChange(false);
        return;
      }
      const f = (e.clientY - d.y0) / d.h;
      const { from, to } = d.range;
      if (d.log) {
        const lf = Math.log(from), lt = Math.log(to), sh = f * (lt - lf);
        d.ps.setVisibleRange({ from: Math.exp(lf + sh), to: Math.exp(lt + sh) });
      } else {
        const sh = f * (to - from);
        d.ps.setVisibleRange({ from: from + sh, to: to + sh });
      }
    });
    const end = () => {
      d = null;
      // Dragging the price axis also turns auto off: keep the "auto" button in step
      setTimeout(() => this.onAutoScaleChange(this.isAutoScale()), 0);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  setVisibleDays(days) {
    if (!this.bars.length) return;
    const to = this.bars[this.bars.length - 1].time;
    const from = days === 'ytd' ? Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000 : to - days * 86400;
    const ts = this.chart.timeScale();
    if (from <= this.bars[0].time) { ts.fitContent(); return; }
    ts.setVisibleRange({ from, to });
  }

  fit() { this.chart.timeScale().fitContent(); }

  screenshot() { return this.chart.takeScreenshot(); }

  // ---------------------------------------------------------------- legends
  buildLegends() {
    this.layer.innerHTML = '';
    this.legends = [];
    const panes = this.chart.panes();
    for (let i = 0; i < panes.length; i++) {
      const box = h('div', { class: 'legend' });
      this.layer.append(box);
      this.legends.push(box);
    }
    const mainRow = h('div', { class: 'lg-row lg-main' },
      h('span', { class: 'lg-title' }, h('b', {}, this.title), h('span', { class: 'lg-sub' }, this.subtitle)),
      h('span', { class: 'lg-vals' }));
    this.mainLegend = mainRow;
    this.legends[0].append(mainRow);

    const overlays = h('div', { class: 'lg-overlays' + (this.overlaysCollapsed ? ' collapsed' : '') });
    this.legends[0].append(overlays);
    let overlayCount = 0;
    for (const e of this.ind) {
      const btn = (icon, title, action) => h('button', { class: 'ibtn sm', title, html: ICONS[icon], onclick: ev => { ev.stopPropagation(); this.onIndicatorAction(action, e.inst); } });
      const row = h('div', { class: 'lg-row lg-ind' + (e.inst.hidden ? ' off' : '') },
        h('span', { class: 'lg-title', ondblclick: () => this.onIndicatorAction('settings', e.inst) }, e.def.short, ' ', h('span', { class: 'lg-args' }, legendArgs(e.inst))),
        h('span', { class: 'lg-vals' }),
        h('span', { class: 'lg-btns' }, btn(e.inst.hidden ? 'eyeOff' : 'eye', 'Show/hide', 'toggle'), btn('gear', 'Settings', 'settings'), btn('x', 'Remove', 'remove')));
      e.legend = row;
      if (e.pane === 0) { overlays.append(row); overlayCount++; } else this.legends[e.pane]?.append(row);
    }
    if (overlayCount) {
      const tog = h('button', { class: 'ibtn sm lg-collapse', title: 'Collapse', html: ICONS.chevUp, onclick: () => {
        this.overlaysCollapsed = !this.overlaysCollapsed;
        overlays.classList.toggle('collapsed', this.overlaysCollapsed);
        tog.classList.toggle('flip', this.overlaysCollapsed);
      } });
      tog.classList.toggle('flip', this.overlaysCollapsed);
      this.legends[0].append(tog);
    }
    this.paneObserver.disconnect();
    this.paneObserver.observe(this.chartEl);
    panes.forEach(p => { const el = p.getHTMLElement(); if (el) this.paneObserver.observe(el); });
    this.positionLegends();
    this.updateLegendValues();
  }

  positionLegends() {
    if (!this.legends) return;
    const base = this.layer.getBoundingClientRect().top;
    this.chart.panes().forEach((p, i) => {
      const el = p.getHTMLElement();
      const box = this.legends[i];
      if (!el || !box) return;
      box.style.top = `${el.getBoundingClientRect().top - base + 4}px`;
    });
    this.drawings.update();
  }

  updateLegendValues() {
    const n = this.bars.length;
    if (!n || !this.mainLegend) return;
    const i = this.crossIdx != null ? Math.max(0, Math.min(n - 1, this.crossIdx)) : n - 1;
    const b = this.bars[i], pb = this.bars[i - 1];
    const p = this.precision;
    const chg = pb ? b.close - pb.close : 0;
    const pct = pb ? (chg / pb.close) * 100 : 0;
    const cls = b.close >= b.open ? 'up' : 'down';
    const f = v => fmtPrice(v, p);
    this.mainLegend.querySelector('.lg-vals').innerHTML =
      `<span>O<i class="${cls}">${f(b.open)}</i></span><span>H<i class="${cls}">${f(b.high)}</i></span>` +
      `<span>L<i class="${cls}">${f(b.low)}</i></span><span>C<i class="${cls}">${f(b.close)}</i></span>` +
      `<i class="${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '+' : '−'}${f(Math.abs(chg))} (${chg >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%)</i>`;
    for (const e of this.ind) {
      if (!e.legend) continue;
      const parts = [];
      for (const plot of e.def.plots) {
        const st = plotStyle(e.inst, plot);
        if (plot.type === 'dots' || st.hidden) continue;
        const o = e.out?.[plot.key];
        const v = o?.values?.[i];
        if (v == null) continue;
        const color = o.colors?.[i] || st.color;
        parts.push(`<i style="color:${escapeHtml(color)}">${e.def.volume ? fmtVol(v) : e.def.overlay ? fmtPrice(v, p) : fmtAuto(v)}</i>`);
      }
      e.legend.querySelector('.lg-vals').innerHTML = parts.join('');
    }
  }
}
