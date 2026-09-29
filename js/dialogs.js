import { h, $, debounce, escapeHtml, hashColor } from './util.js';
import { ICONS } from './icons.js';
import { INDICATORS, paramsWithDefaults, plotStyle, LINE_STYLES, PLOT_TYPES, VIS_UNITS } from './indicators.js';
import { searchSymbols } from './data.js';
import { resolve, avatarText, icon } from './symbols.js';

const root = () => document.getElementById('modal-root');

export function modal({ title, body, footer, cls = '', onClose }) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const box = h('div', { class: `modal ${cls}`, role: 'dialog' },
    h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'ibtn', title: 'Close', html: ICONS.x, onclick: close })),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null);
  const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) close(); } }, box);
  root().append(overlay);
  document.addEventListener('keydown', onKey, true);
  return { box, close };
}

export function prompt(title, { value = '', placeholder = '', label = '', multiline = false, okText = 'OK' } = {}) {
  return new Promise(resolvePromise => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolvePromise(v); } m.close(); };
    const input = multiline
      ? h('textarea', { class: 'input', rows: 3, placeholder })
      : h('input', { class: 'input', placeholder, onkeydown: e => { if (e.key === 'Enter') finish(input.value.trim()); } });
    input.value = value;
    const m = modal({
      title, cls: 'small',
      body: h('div', { class: 'form' }, label ? h('label', {}, label) : null, input),
      footer: [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => finish(multiline ? input.value : input.value.trim()) }, okText)],
      onClose: () => { if (!done) { done = true; resolvePromise(null); } },
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

export function confirm(title, message, { okText = 'OK', danger = false } = {}) {
  return new Promise(resolvePromise => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolvePromise(v); } m.close(); };
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => finish(true) }, okText);
    const m = modal({
      title, cls: 'small',
      body: h('p', { class: 'muted' }, message),
      footer: [h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), ok],
      onClose: () => { if (!done) { done = true; resolvePromise(false); } },
    });
    setTimeout(() => ok.focus(), 30);
  });
}

// Popup menu anchored to an element. items: {label, icon, onClick, hint, danger, header, sep, active, right}
let openMenu = null;
export function menu(anchor, items, { align = 'left', cls = '' } = {}) {
  closeMenu();
  const el = h('div', { class: `menu ${cls}` });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { el.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.header) { el.append(h('div', { class: 'menu-header' }, it.header)); continue; }
    if (it.el) { el.append(it.el); continue; }
    const row = h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.active ? ' active' : ''}`,
      onclick: e => { e.stopPropagation(); if (!it.keepOpen) closeMenu(); it.onClick?.(e); },
    },
    it.icon ? h('span', { class: 'mi-icon', html: ICONS[it.icon] || '' }) : null,
    h('span', { class: 'mi-label' }, it.label),
    it.hint ? h('span', { class: 'mi-hint' }, it.hint) : null,
    it.right || null);
    el.append(row);
  }
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(6, Math.min(left, window.innerWidth - mw - 6));
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 6) top = Math.max(6, r.top - mh - 4);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  const onDoc = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  const onKey = e => { if (e.key === 'Escape') closeMenu(); };
  setTimeout(() => { document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey); }, 0);
  openMenu = { el, off: () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); } };
  return el;
}
export function closeMenu() {
  if (openMenu) { openMenu.off(); openMenu.el.remove(); openMenu = null; }
}

export function avatar(r, size = 20) {
  const url = icon(r);
  const el = h('span', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, background: hashColor(r.display), fontSize: `${Math.round(size * 0.5)}px` } }, avatarText(r));
  if (url) {
    const img = h('img', { src: url, alt: '', loading: 'lazy', onerror: () => img.remove() });
    el.append(img);
  }
  return el;
}

// ------------------------------------------------------------------ symbol search
export function symbolSearch({ title = 'Symbol search', initial = '', mode = 'chart', onPick, inList = () => false }) {
  let results = [];
  let sel = 0;
  let seq = 0;
  const input = h('input', { class: 'input search-input', placeholder: 'Symbol or name — e.g. BTCUSD, BINANCE:ETHUSDT, AAPL, SPX, D05.SI, USDSGD', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'search-results' });
  const status = h('div', { class: 'search-status muted' });
  const hint = h('div', { class: 'search-hint muted', html:
    '<b>USDT</b> pairs (and <b>BINANCE:</b>) stream live from Binance. Everything else — stocks, indices (SPX, NDX, HSI), FX (USDSGD), futures (ES1!), crypto USD pairs (BTCUSD) — comes from Yahoo Finance.' });

  const render = () => {
    list.innerHTML = '';
    results.forEach((r, i) => {
      const res = resolve(r.key);
      const added = mode === 'add' && inList(r.key);
      const row = h('div', { class: `search-row${i === sel ? ' sel' : ''}`, onmousemove: () => { if (sel !== i) { sel = i; mark(); } }, onclick: () => pick(i) },
        avatar(res, 22),
        h('span', { class: 'sr-sym' }, res.display),
        h('span', { class: 'sr-desc' }, r.desc || res.desc || ''),
        h('span', { class: 'sr-type' }, r.type || ''),
        h('span', { class: `sr-ex ${r.src}` }, r.exchange || (r.src === 'binance' ? 'Binance' : 'Yahoo')),
        mode === 'add' ? h('span', { class: `sr-add${added ? ' done' : ''}`, html: added ? '✓' : ICONS.plus }) : null);
      list.append(row);
    });
  };
  const mark = () => [...list.children].forEach((c, i) => c.classList.toggle('sel', i === sel));

  const run = debounce(async q => {
    const my = ++seq;
    if (!q.trim()) { results = []; render(); status.textContent = ''; return; }
    status.textContent = 'Searching…';
    const upd = r => { if (my === seq) { results = r; sel = Math.min(sel, Math.max(0, r.length - 1)); render(); } };
    try {
      await searchSymbols(q, upd);
      if (my === seq) status.textContent = results.length ? '' : 'No results';
    } catch (e) {
      if (my === seq) status.textContent = e.message;
    }
  }, 220);

  const pick = i => {
    const r = results[i];
    if (!r) return;
    onPick(r.key);
    if (mode === 'chart') m.close();
    else render();
  };

  input.addEventListener('input', () => { sel = 0; run(input.value); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); mark(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'Enter') {
      if (results.length) pick(sel);
      else if (input.value.trim()) { onPick(resolve(input.value).key); if (mode === 'chart') m.close(); }
    }
  });
  const m = modal({ title, cls: 'search', body: h('div', { class: 'search-box' }, h('div', { class: 'search-field', html: ICONS.search }, input), status, list, hint) });
  input.value = initial;
  if (initial) run(initial);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  return m;
}

// ------------------------------------------------------------------ indicators
export function indicatorPicker(onAdd) {
  const input = h('input', { class: 'input', placeholder: 'Search indicators' });
  const list = h('div', { class: 'ind-list' });
  const render = () => {
    const q = input.value.toLowerCase();
    list.innerHTML = '';
    for (const [type, def] of Object.entries(INDICATORS)) {
      if (q && !def.name.toLowerCase().includes(q) && !def.short.toLowerCase().includes(q)) continue;
      list.append(h('button', { class: 'ind-item', onclick: e => { onAdd(type); flash(e.currentTarget); } },
        h('span', {}, def.name), h('span', { class: 'muted' }, def.overlay ? 'on chart' : 'new pane')));
    }
  };
  const flash = el => { el.classList.add('added'); setTimeout(() => el.classList.remove('added'), 700); };
  input.addEventListener('input', render);
  render();
  modal({ title: 'Indicators', cls: 'indicators', body: h('div', { class: 'form' }, input, list) });
  setTimeout(() => input.focus(), 20);
}

// TradingView-style settings: Inputs / Style / Visibility tabs.
// onApply({ params, colors, styles, visibility }); onSaveDefault(sameShape)
export function indicatorSettings(inst, onApply, onSaveDefault) {
  const def = INDICATORS[inst.type];
  const p = paramsWithDefaults(inst);

  // ---- Inputs
  const inputs = {};
  const inputsPane = h('div', { class: 'form grid2' });
  for (const x of def.params) {
    let el;
    if (x.type === 'select') el = h('select', { class: 'input' }, ...x.options.map(o => h('option', { value: o, selected: o === p[x.key] }, o)));
    else if (x.type === 'bool') el = h('input', { type: 'checkbox', checked: !!p[x.key] });
    else el = h('input', { class: 'input', type: 'number', step: x.step || 1, min: x.min ?? '', value: p[x.key] });
    inputs[x.key] = el;
    inputsPane.append(h('label', {}, x.label), el);
  }
  if (!def.params.length) inputsPane.append(h('p', { class: 'muted' }, 'This indicator has no inputs.'));

  // ---- Style
  const styleCtl = {};
  const stylePane = h('div', { class: 'style-grid' });
  for (const pl of def.plots) {
    const st = plotStyle(inst, pl);
    const perPointColors = pl.type === 'histogram' || pl.type === 'dots';
    const c = {
      show: h('input', { type: 'checkbox', checked: !st.hidden }),
      color: h('input', { type: 'color', value: st.hex, title: 'Color' }),
      opacity: h('input', { type: 'range', min: 0, max: 100, value: st.opacity, title: 'Opacity' }),
      width: h('select', { class: 'input sm', title: 'Thickness' }, ...[1, 2, 3, 4].map(w => h('option', { value: w, selected: w === st.width }, `${w}px`))),
      lineStyle: h('select', { class: 'input sm', title: 'Line style' }, ...LINE_STYLES.map(([v, l]) => h('option', { value: v, selected: v === st.lineStyle }, l))),
      plotType: h('select', { class: 'input sm', title: 'Plot type' }, ...PLOT_TYPES.map(([v, l]) => h('option', { value: v, selected: v === st.plotType }, l))),
      perPointColors,
    };
    const pct = h('span', { class: 'muted small op-val' }, `${st.opacity}%`);
    c.opacity.addEventListener('input', () => { pct.textContent = `${c.opacity.value}%`; });
    styleCtl[pl.key] = c;
    stylePane.append(h('label', { class: 'check st-name' }, c.show, pl.label));
    stylePane.append(perPointColors
      ? h('span', { class: 'muted small st-note' }, 'colored by value')
      : h('div', { class: 'st-ctl' }, c.color, h('span', { class: 'op' }, c.opacity, pct), c.width, c.lineStyle, c.plotType));
  }

  // ---- Visibility
  const visCtl = {};
  const visPane = h('div', { class: 'vis-grid' });
  for (const [unit, label, max] of VIS_UNITS) {
    const v = inst.visibility?.[unit] || {};
    const c = {
      on: h('input', { type: 'checkbox', checked: v.on !== false }),
      min: h('input', { class: 'input', type: 'number', min: 1, max, value: v.min ?? 1 }),
      max: h('input', { class: 'input', type: 'number', min: 1, max, value: v.max ?? max }),
      rmin: h('input', { type: 'range', min: 1, max, value: v.min ?? 1 }),
      rmax: h('input', { type: 'range', min: 1, max, value: v.max ?? max }),
    };
    const clamp = x => Math.max(1, Math.min(max, parseInt(x, 10) || 1));
    const sync = from => {
      let lo = clamp(from === 'range' ? c.rmin.value : c.min.value), hi = clamp(from === 'range' ? c.rmax.value : c.max.value);
      if (lo > hi) [lo, hi] = from === 'range' && document.activeElement === c.rmax ? [hi, hi] : [lo, lo];
      c.min.value = c.rmin.value = lo;
      c.max.value = c.rmax.value = hi;
      const span = max - 1 || 1;
      fill.style.left = `${((lo - 1) / span) * 100}%`;
      fill.style.right = `${100 - ((hi - 1) / span) * 100}%`;
      row.classList.toggle('off', !c.on.checked);
    };
    const fill = h('i', { class: 'dual-fill' });
    const row = h('div', { class: 'vis-row' },
      h('label', { class: 'check' }, c.on, label),
      c.min,
      h('div', { class: 'dual' }, h('span', { class: 'dual-track' }, fill), c.rmin, c.rmax),
      c.max);
    [c.rmin, c.rmax].forEach(r => r.addEventListener('input', () => sync('range')));
    [c.min, c.max].forEach(r => r.addEventListener('change', () => sync('num')));
    c.on.addEventListener('change', () => sync('num'));
    visCtl[unit] = c;
    visPane.append(row);
    sync('num');
  }
  visPane.append(h('p', { class: 'muted small' }, 'The indicator is only drawn on timeframes that are ticked and within the range.'));

  // ---- tabs
  const panes = { Inputs: inputsPane, Style: stylePane, Visibility: visPane };
  const tabBar = h('div', { class: 'tabs' });
  const holder = h('div', { class: 'tab-body' });
  const show = name => {
    [...tabBar.children].forEach(b => b.classList.toggle('active', b.textContent === name));
    holder.innerHTML = '';
    holder.append(panes[name]);
  };
  for (const name of Object.keys(panes)) tabBar.append(h('button', { class: 'tab', onclick: () => show(name) }, name));
  show('Inputs');

  const collect = () => {
    const params = {};
    for (const x of def.params) {
      const el = inputs[x.key];
      if (x.type === 'bool') params[x.key] = el.checked;
      else if (x.type === 'select') params[x.key] = el.value;
      else {
        let v = x.type === 'int' ? parseInt(el.value, 10) : parseFloat(el.value);
        if (!isFinite(v)) v = x.def;
        if (x.min != null) v = Math.max(x.min, v);
        params[x.key] = v;
      }
    }
    const colors = {}, styles = {};
    for (const pl of def.plots) {
      const c = styleCtl[pl.key];
      const dflt = plotStyle({}, pl);
      const st = {};
      if (!c.show.checked) st.hidden = true;
      if (!c.perPointColors) {
        if (c.color.value !== dflt.hex) colors[pl.key] = c.color.value;
        if (+c.opacity.value !== dflt.opacity) st.opacity = +c.opacity.value;
        if (+c.width.value !== dflt.width) st.width = +c.width.value;
        if (+c.lineStyle.value !== 0) st.lineStyle = +c.lineStyle.value;
        if (c.plotType.value !== 'line') st.plotType = c.plotType.value;
      }
      if (Object.keys(st).length) styles[pl.key] = st;
    }
    const visibility = {};
    for (const [unit, , max] of VIS_UNITS) {
      const c = visCtl[unit];
      const v = { on: c.on.checked, min: +c.min.value, max: +c.max.value };
      if (!v.on || v.min !== 1 || v.max !== max) visibility[unit] = v;
    }
    return { params, colors, styles, visibility };
  };

  const dfltBtn = h('button', { class: 'btn', onclick: e => menu(e.currentTarget, [
    { label: 'Reset settings', onClick: () => { onApply({ params: {}, colors: {}, styles: {}, visibility: {} }); m.close(); } },
    onSaveDefault ? { label: 'Save as default', onClick: () => { onSaveDefault(collect()); } } : null,
  ]) }, 'Defaults ', h('span', { class: 'chev', html: ICONS.chevDown }));
  const m = modal({
    title: def.short === def.name ? def.name : `${def.short} — ${def.name}`, cls: 'ind-settings',
    body: h('div', {}, tabBar, holder),
    footer: [
      dfltBtn,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => { onApply(collect()); m.close(); } }, 'OK'),
    ],
  });
}

export { escapeHtml, $ };
