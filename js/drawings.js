// Drawing tools rendered as a series primitive on the main price series.
// Points are stored as { t: barTime, p: price } so drawings survive timeframe changes.
import { h, uid, fmtAuto, fmtPrice } from './util.js';

export const TOOLS = {
  trend: { label: 'Trend line', pts: 2 },
  ray: { label: 'Ray', pts: 2 },
  extended: { label: 'Extended line', pts: 2 },
  hline: { label: 'Horizontal line', pts: 1 },
  hray: { label: 'Horizontal ray', pts: 1 },
  vline: { label: 'Vertical line', pts: 1 },
  rect: { label: 'Rectangle', pts: 2 },
  fib: { label: 'Fib retracement', pts: 2 },
  range: { label: 'Price range', pts: 2 },
  text: { label: 'Text', pts: 1 },
};

const FIB = [
  [0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'],
  [0.618, '#089981'], [0.786, '#00bcd4'], [1, '#787b86'], [1.618, '#2962ff'],
];

const DEFAULT_COLOR = { hline: '#f7c948', hray: '#f7c948', vline: '#5b8cff', rect: '#9c27b0', fib: '#787b86', range: '#2962ff', text: '#d1d4dc' };

function distSeg(px, py, x1, y1, x2, y2, mode = 'seg') {
  const dx = x2 - x1, dy = y2 - y1;
  const L = dx * dx + dy * dy;
  let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  if (mode === 'seg') t = Math.max(0, Math.min(1, t));
  else if (mode === 'ray') t = Math.max(0, t);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function extendTo(x1, y1, x2, y2, W, H) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const k = ((W + H) * 4) / len;
  return [x2 + dx * k, y2 + dy * k];
}

const alpha = (hex, a) => {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

export class Drawings {
  constructor(cv) {
    this.cv = cv;
    this.items = [];
    this.tool = null;
    this.draft = null;
    this.selected = null;
    this.hidden = false;
    this.magnet = false;
    this.drag = null;
    this.hover = null;
    this.onChange = () => {};
    this.onToolChange = () => {};
    this.onEditText = null; // async (initial) => string|null
    this._requestUpdate = () => {};
    const self = this;
    this.primitive = {
      attached({ requestUpdate }) { self._requestUpdate = requestUpdate; },
      detached() { self._requestUpdate = () => {}; },
      updateAllViews() {},
      paneViews() {
        return [{ zOrder: () => 'top', renderer: () => ({ draw: target => self.draw(target) }) }];
      },
    };
    this.toolbar = this.buildToolbar();
    cv.wrap.append(this.toolbar);
    const el = cv.chartEl;
    el.addEventListener('pointerdown', e => this.onDown(e), true);
    el.addEventListener('pointermove', e => this.onMove(e), true);
    window.addEventListener('pointerup', e => this.onUp(e), true);
    el.addEventListener('dblclick', e => this.onDbl(e), true);
  }

  attach(series) { series.attachPrimitive(this.primitive); }
  update() { this._requestUpdate(); this.positionToolbar(); }

  setItems(items) {
    this.items = items || [];
    this.selected = null;
    this.draft = null;
    this.update();
  }

  setTool(tool) {
    this.tool = tool;
    this.draft = null;
    this.setScroll(!tool);
    this.cv.chartEl.style.cursor = tool ? 'crosshair' : '';
    this.onToolChange(tool);
    this.update();
  }

  setScroll(on) {
    if (this._scroll === on) return;
    this._scroll = on;
    this.cv.chart.applyOptions({ handleScroll: on, handleScale: on });
  }

  commit() { this.onChange(this.items); }

  remove(item) {
    this.items = this.items.filter(d => d !== item);
    if (this.selected === item) this.selected = null;
    this.commit();
    this.update();
  }

  clear() {
    this.items = [];
    this.selected = null;
    this.commit();
    this.update();
  }

  // ---------------------------------------------------------- geometry
  xy(pt) {
    const x = this.cv.timeToX(pt.t);
    const y = this.cv.main?.priceToCoordinate(pt.p);
    return [x, y];
  }

  eventPoint(e) {
    const r = this.cv.chartEl.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const size = this.cv.chart.paneSize(0);
    return { x, y, inPane: x >= 0 && y >= 0 && x <= size.width && y <= size.height };
  }

  toPoint(x, y) {
    const ts = this.cv.chart.timeScale();
    let l = ts.coordinateToLogical(x);
    if (l == null) return null;
    l = Math.round(l);
    let p = this.cv.main.coordinateToPrice(y);
    if (p == null) return null;
    const bars = this.cv.bars;
    if (this.magnet && l >= 0 && l < bars.length) {
      const b = bars[l];
      let best = p, bd = Infinity;
      for (const v of [b.open, b.high, b.low, b.close]) {
        const d = Math.abs(this.cv.main.priceToCoordinate(v) - y);
        if (d < bd) { bd = d; best = v; }
      }
      if (bd < 40) p = best;
    }
    return { t: this.cv.logicalToTime(l), p };
  }

  // ---------------------------------------------------------- rendering
  draw(target) {
    if (this.hidden || !this.cv.main) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width, H = mediaSize.height;
      const list = this.draft ? [...this.items, this.draft] : this.items;
      for (const d of list) {
        try { this.drawItem(ctx, d, W, H); } catch { /* skip malformed */ }
      }
    });
  }

  drawItem(ctx, d, W, H) {
    const pts = d.pts.map(p => this.xy(p));
    if (pts.some(([x, y]) => x == null || y == null)) return;
    const sel = d === this.selected || d === this.draft;
    const color = d.color || DEFAULT_COLOR[d.type] || '#2962ff';
    ctx.save();
    ctx.lineWidth = d.width || 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.font = '12px -apple-system, "Segoe UI", Roboto, sans-serif';
    const [a, b] = pts;
    const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const priceTag = (y, price) => {
      const txt = fmtPrice(price, this.cv.precision);
      const w = ctx.measureText(txt).width + 10;
      ctx.fillStyle = color;
      ctx.fillRect(W - w, y - 9, w, 18);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, W - w + 5, y);
    };
    switch (d.type) {
      case 'trend': line(a[0], a[1], b[0], b[1]); break;
      case 'ray': { const [ex, ey] = extendTo(a[0], a[1], b[0], b[1], W, H); line(a[0], a[1], ex, ey); break; }
      case 'extended': {
        const [ex, ey] = extendTo(a[0], a[1], b[0], b[1], W, H);
        const [sx, sy] = extendTo(b[0], b[1], a[0], a[1], W, H);
        line(sx, sy, ex, ey);
        break;
      }
      case 'hline': line(0, a[1], W, a[1]); priceTag(a[1], d.pts[0].p); break;
      case 'hray': line(a[0], a[1], W, a[1]); priceTag(a[1], d.pts[0].p); break;
      case 'vline': {
        line(a[0], 0, a[0], H);
        if (d.text) {
          ctx.textBaseline = 'top';
          ctx.textAlign = 'center';
          d.text.split('\n').forEach((t, i) => ctx.fillText(t, a[0], 6 + i * 14));
        }
        break;
      }
      case 'rect': {
        ctx.fillStyle = alpha(color, 0.18);
        ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        break;
      }
      case 'fib': {
        const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]);
        const p0 = d.pts[1].p, p1 = d.pts[0].p;
        ctx.lineWidth = 1;
        ctx.textBaseline = 'bottom';
        for (const [lv, c] of FIB) {
          const price = p0 + (p1 - p0) * lv;
          const y = this.cv.main.priceToCoordinate(price);
          if (y == null) continue;
          ctx.strokeStyle = c;
          ctx.fillStyle = c;
          line(x1, y, x2, y);
          ctx.fillText(`${lv} (${fmtPrice(price, this.cv.precision)})`, x1 + 4, y - 2);
        }
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = alpha('#787b86', 0.8);
        line(a[0], a[1], b[0], b[1]);
        break;
      }
      case 'range': {
        const up = d.pts[1].p >= d.pts[0].p;
        const c = up ? '#2962ff' : '#f23645';
        ctx.fillStyle = alpha(c, 0.18);
        const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
        const w = Math.abs(b[0] - a[0]), hh = Math.abs(b[1] - a[1]);
        ctx.fillRect(x, y, w, hh);
        ctx.strokeStyle = c;
        ctx.lineWidth = 1;
        line(a[0], a[1], a[0], b[1]);
        line(a[0], b[1], b[0], b[1]);
        const diff = d.pts[1].p - d.pts[0].p;
        const pct = (diff / d.pts[0].p) * 100;
        const la = this.cv.timeToLogical(d.pts[0].t), lb = this.cv.timeToLogical(d.pts[1].t);
        const txt = `${diff >= 0 ? '+' : ''}${fmtAuto(diff)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  ${Math.round(lb - la)} bars`;
        const tw = ctx.measureText(txt).width + 12;
        const ly = up ? y - 24 : y + hh + 4;
        ctx.fillStyle = c;
        ctx.fillRect(x + w / 2 - tw / 2, ly, tw, 20);
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(txt, x + w / 2, ly + 10);
        break;
      }
      case 'text': {
        ctx.font = `${d.size || 14}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textBaseline = 'top';
        (d.text || 'Text').split('\n').forEach((t, i) => ctx.fillText(t, a[0], a[1] + i * ((d.size || 14) + 4)));
        break;
      }
    }
    if (sel) {
      ctx.setLineDash([]);
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#131722';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#2962ff';
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------- hit testing
  hitTest(x, y) {
    if (this.hidden) return null;
    const size = this.cv.chart.paneSize(0);
    const W = size.width, H = size.height;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      const pts = d.pts.map(p => this.xy(p));
      if (pts.some(([px, py]) => px == null || py == null)) continue;
      for (let j = 0; j < pts.length; j++) {
        if (Math.hypot(x - pts[j][0], y - pts[j][1]) < 8) return { item: d, handle: j };
      }
      const [a, b] = pts;
      const T = 6;
      let hit = false;
      switch (d.type) {
        case 'trend': hit = distSeg(x, y, a[0], a[1], b[0], b[1]) < T; break;
        case 'ray': hit = distSeg(x, y, a[0], a[1], b[0], b[1], 'ray') < T; break;
        case 'extended': hit = distSeg(x, y, a[0], a[1], b[0], b[1], 'line') < T; break;
        case 'hline': hit = Math.abs(y - a[1]) < T; break;
        case 'hray': hit = Math.abs(y - a[1]) < T && x >= a[0] - T; break;
        case 'vline': hit = Math.abs(x - a[0]) < T && y <= H; break;
        case 'rect': case 'range':
          hit = x >= Math.min(a[0], b[0]) - T && x <= Math.max(a[0], b[0]) + T && y >= Math.min(a[1], b[1]) - T && y <= Math.max(a[1], b[1]) + T;
          break;
        case 'fib': {
          if (x < Math.min(a[0], b[0]) - T || x > Math.max(a[0], b[0]) + T) break;
          for (const [lv] of FIB) {
            const yy = this.cv.main.priceToCoordinate(d.pts[1].p + (d.pts[0].p - d.pts[1].p) * lv);
            if (yy != null && Math.abs(y - yy) < T) { hit = true; break; }
          }
          break;
        }
        case 'text': {
          const lines = (d.text || 'Text').split('\n');
          const sz = d.size || 14;
          const w = Math.max(...lines.map(l => l.length)) * sz * 0.6;
          hit = x >= a[0] - 4 && x <= a[0] + w && y >= a[1] - 4 && y <= a[1] + lines.length * (sz + 4);
          break;
        }
      }
      if (hit && x <= W) return { item: d, handle: null };
    }
    return null;
  }

  // ---------------------------------------------------------- interaction
  onDown(e) {
    if (e.button !== 0 || !this.cv.main) return;
    const { x, y, inPane } = this.eventPoint(e);
    if (this.tool) {
      if (!inPane) return;
      e.stopPropagation();
      const pt = this.toPoint(x, y);
      if (!pt) return;
      const spec = TOOLS[this.tool];
      if (this.draft) { // second click of click-move-click
        this.draft.pts[1] = pt;
        this.finish();
        return;
      }
      const d = { id: uid(), type: this.tool, pts: spec.pts === 2 ? [pt, { ...pt }] : [pt], color: DEFAULT_COLOR[this.tool] || '#2962ff', width: this.tool === 'rect' ? 1 : 2 };
      if (spec.pts === 1) {
        this.draft = d;
        this.finish();
      } else {
        this.draft = d;
        this.downAt = [x, y];
      }
      this.update();
      return;
    }
    if (!inPane) return;
    const hit = this.hitTest(x, y);
    if (hit) {
      e.stopPropagation();
      this.setScroll(false);
      this.selected = hit.item;
      this.drag = { item: hit.item, handle: hit.handle, start: this.toPoint(x, y), startL: this.cv.chart.timeScale().coordinateToLogical(x), orig: hit.item.pts.map(p => ({ ...p })), moved: false };
      this.update();
    } else if (this.selected) {
      this.selected = null;
      this.update();
    }
  }

  onMove(e) {
    if (!this.cv.main) return;
    const { x, y, inPane } = this.eventPoint(e);
    if (this.draft && this.draft.pts.length === 2) {
      const pt = this.toPoint(x, y);
      if (pt) { this.draft.pts[1] = pt; this.update(); }
      return;
    }
    if (this.drag) {
      const d = this.drag;
      const pt = this.toPoint(x, y);
      if (!pt || !d.start) return;
      d.moved = true;
      if (d.handle != null) {
        d.item.pts[d.handle] = pt;
      } else {
        const ts = this.cv.chart.timeScale();
        const dl = Math.round(ts.coordinateToLogical(x) - d.startL);
        const dp = pt.p - d.start.p;
        d.item.pts = d.orig.map(o => ({ t: this.cv.logicalToTime(Math.round(this.cv.timeToLogical(o.t)) + dl), p: o.p + dp }));
      }
      this.update();
      return;
    }
    if (this.tool || e.buttons) return;
    const hit = inPane ? this.hitTest(x, y) : null;
    this.cv.chartEl.style.cursor = hit ? (hit.handle != null ? 'grab' : 'pointer') : '';
    this.setScroll(!hit);
  }

  onUp(e) {
    if (this.draft && this.downAt) {
      const { x, y } = this.eventPoint(e);
      if (Math.hypot(x - this.downAt[0], y - this.downAt[1]) > 8) this.finish();
      this.downAt = null;
      return;
    }
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      if (moved) this.commit();
      this.setScroll(true);
      this.update();
    }
  }

  async onDbl(e) {
    const { x, y, inPane } = this.eventPoint(e);
    if (!inPane) return;
    const hit = this.hitTest(x, y);
    if (hit && ['text', 'vline', 'hline'].includes(hit.item.type)) {
      e.stopPropagation();
      this.editText(hit.item);
    }
  }

  async finish() {
    const d = this.draft;
    this.draft = null;
    this.downAt = null;
    if (!d) return;
    this.items.push(d);
    this.selected = d;
    this.setTool(null);
    if (d.type === 'text') {
      const ok = await this.editText(d);
      if (!ok) return;
    }
    this.commit();
    this.update();
  }

  async editText(d) {
    if (!this.onEditText) return false;
    const t = await this.onEditText(d.text || '', d.type);
    if (t == null) {
      if (d.type === 'text' && !d.text) this.remove(d);
      return false;
    }
    d.text = t;
    this.commit();
    this.update();
    return true;
  }

  // ---------------------------------------------------------- floating toolbar
  buildToolbar() {
    const color = h('input', { type: 'color', title: 'Color', oninput: e => { if (this.selected) { this.selected.color = e.target.value; this.update(); } }, onchange: () => this.commit() });
    const width = h('select', { title: 'Line width', onchange: e => { if (this.selected) { this.selected.width = +e.target.value; this.commit(); this.update(); } } },
      ...[1, 2, 3, 4].map(w => h('option', { value: w }, `${w}px`)));
    const text = h('button', { class: 'ibtn', title: 'Edit text', onclick: () => this.selected && this.editText(this.selected) }, 'T');
    const del = h('button', { class: 'ibtn danger', title: 'Delete (Del)', onclick: () => this.selected && this.remove(this.selected), html: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>' });
    const bar = h('div', { class: 'draw-toolbar hidden' }, color, width, text, del);
    bar._color = color; bar._width = width; bar._text = text;
    return bar;
  }

  positionToolbar() {
    const d = this.selected;
    const bar = this.toolbar;
    if (!d || this.hidden || this.drag) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const c = d.color || DEFAULT_COLOR[d.type] || '#2962ff';
    if (/^#[0-9a-f]{6}$/i.test(c)) bar._color.value = c;
    bar._width.value = d.width || 2;
    bar._text.style.display = ['text', 'vline', 'hline'].includes(d.type) ? '' : 'none';
  }
}
