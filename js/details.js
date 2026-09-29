// Symbol details panel (below the watchlist)
import { h, fmtPrice, fmtSigned, fmtPct, fmtVol, autoPrecision, upDownClass } from './util.js';
import { getQuote, loadBars } from './data.js';
import { avatar } from './dialogs.js';

const PERF = [['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['YTD', 'ytd'], ['1Y', 365]];

export class Details {
  constructor(el) {
    this.el = el;
    this.res = null;
    this.perf = null;
    this.meta = {};
  }

  set(res, meta = {}) {
    const changed = !this.res || this.res.key !== res.key;
    this.res = res;
    this.meta = meta;
    if (changed) {
      this.perf = null;
      this.loadPerf(res);
    }
    this.render();
  }

  async loadPerf(res) {
    try {
      const { bars } = await loadBars(res, '1D', { range: '2y' });
      if (this.res?.key !== res.key || !bars.length) return;
      const last = bars[bars.length - 1];
      const out = {};
      for (const [label, days] of PERF) {
        const from = days === 'ytd' ? Date.UTC(new Date(last.time * 1000).getUTCFullYear(), 0, 1) / 1000 - 86400 : last.time - days * 86400;
        let ref = null;
        for (let i = bars.length - 1; i >= 0; i--) if (bars[i].time <= from) { ref = bars[i]; break; }
        out[label] = ref ? ((last.close - ref.close) / ref.close) * 100 : null;
      }
      this.perf = out;
      this.render();
    } catch { /* performance is optional */ }
  }

  render() {
    const r = this.res;
    if (!r) return;
    const q = getQuote(r) || {};
    const p = q.precision ?? this.meta.precision ?? (q.price ? autoPrecision(q.price) : 2);
    const name = q.name || this.meta.name || r.desc || r.sym;
    const exch = [q.exchange || this.meta.exchange || r.exchange, (q.type || r.type || '').replace('cryptocurrency', 'crypto')].filter(Boolean).join(' · ');
    const cls = upDownClass(q.change);
    const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'muted' }, label), h('span', {}, value));
    const rangeBar = (lo, hi, v) => {
      if (lo == null || hi == null || v == null || hi <= lo) return null;
      const pct = Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
      return h('div', { class: 'range' }, h('span', {}, fmtPrice(lo, p)), h('div', { class: 'range-bar' }, h('i', { style: { left: `${pct}%` } })), h('span', {}, fmtPrice(hi, p)));
    };
    const status = q.open == null ? null : h('div', { class: `mkt ${q.open ? 'open' : 'closed'}` }, q.open ? 'Market open' : 'Market closed');

    this.el.innerHTML = '';
    this.el.append(...[
      h('div', { class: 'd-head' }, avatar(r, 26), h('div', {}, h('div', { class: 'd-sym' }, r.display), h('div', { class: 'd-name muted' }, name))),
      h('div', { class: 'd-ex muted' }, exch, r.src === 'yahoo' && r.sym !== r.display ? ` · ${r.sym}` : ''),
      h('div', { class: 'd-price' },
        h('span', { class: 'big' }, q.price != null ? fmtPrice(q.price, p) : '—'),
        h('span', { class: 'cur muted' }, q.currency || this.meta.currency || ''),
        h('span', { class: `d-chg ${cls}` }, `${fmtSigned(q.change, p)}  ${fmtPct(q.pct)}`)),
      status,
      h('div', { class: 'd-section' }, 'Key stats'),
      stat('Volume', fmtVol(q.volume)),
      q.prev != null ? stat(r.src === 'binance' ? '24h open' : 'Prev close', fmtPrice(q.prev, p)) : null,
      h('div', { class: 'stat col' }, h('span', { class: 'muted' }, r.src === 'binance' ? '24h range' : "Day's range"), rangeBar(q.low, q.high, q.price) || h('span', {}, '—')),
      q.w52h != null ? h('div', { class: 'stat col' }, h('span', { class: 'muted' }, '52 week range'), rangeBar(q.w52l, q.w52h, q.price)) : null,
      h('div', { class: 'd-section' }, 'Performance'),
      h('div', { class: 'perf' }, ...PERF.map(([label]) => {
        const v = this.perf?.[label];
        return h('div', { class: `perf-cell ${v == null ? '' : v >= 0 ? 'pos' : 'neg'}` }, h('b', {}, v == null ? '—' : fmtPct(v)), h('span', {}, label));
      })),
    ].filter(Boolean));
  }
}
