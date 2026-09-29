import { store } from './store.js';
import { h, uid, fmtPrice, fmtPct, fmtSigned, autoPrecision, upDownClass, toast, download, pickFile } from './util.js';
import { ICONS } from './icons.js';
import { resolve } from './symbols.js';
import { quotes, qkey } from './data.js';
import { menu, modal, prompt, confirm, symbolSearch, avatar } from './dialogs.js';

const isSection = s => s.startsWith('###');
const sectionName = s => s.slice(3);
const resCache = new Map();
export const res = key => { let r = resCache.get(key); if (!r) { r = resolve(key); resCache.set(key, r); } return r; };

export function parseListText(text) {
  const t = text.trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    return { name: j.name, items: j.items || [] };
  }
  // TradingView export: comma or newline separated, sections as ###Name
  const items = t.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean);
  return { name: null, items };
}

export class Watchlist {
  constructor(el, { onSelect, onChange, getCurrent }) {
    this.el = el;
    this.onSelect = onSelect;
    this.onChange = onChange;
    this.getCurrent = getCurrent;
    this.rows = new Map();
    this.sort = null; // { col, dir }
    this.last = new Map();
    this.build();
  }

  get s() { return store.s; }
  get list() { return this.s.lists[this.s.activeList] || this.s.lists[this.s.listOrder[0]]; }

  save() { store.save(); this.onChange?.(); }

  // symbols (in display order, sections skipped)
  symbols() {
    return this.visibleItems().filter(x => !isSection(x.item)).map(x => x.item);
  }

  build() {
    this.nameBtn = h('button', { class: 'wl-name', onclick: e => this.openMenu(e.currentTarget) });
    this.head = h('div', { class: 'wl-head' },
      this.nameBtn,
      h('span', { class: 'grow' }),
      h('button', { class: 'ibtn', title: 'Add symbol', html: ICONS.plus, onclick: () => this.addSymbolDialog() }),
      h('button', { class: 'ibtn', title: 'More', html: ICONS.more, onclick: e => this.openMenu(e.currentTarget, true) }));
    const col = (key, label) => h('button', { class: `wl-col c-${key}`, onclick: () => this.toggleSort(key) }, label);
    this.cols = h('div', { class: 'wl-cols' }, col('sym', 'Symbol'), col('last', 'Last'), col('chg', 'Chg'), col('pct', 'Chg%'));
    this.body = h('div', { class: 'wl-body' });
    this.body.addEventListener('dragover', e => e.preventDefault());
    this.el.append(this.head, this.cols, this.body);
  }

  toggleSort(col) {
    if (!this.sort || this.sort.col !== col) this.sort = { col, dir: 1 };
    else if (this.sort.dir === 1) this.sort.dir = -1;
    else this.sort = null;
    this.render();
  }

  // items grouped by sections with sorting applied inside each section
  visibleItems() {
    const items = this.list?.items || [];
    const groups = [];
    let cur = { section: null, idx: -1, rows: [] };
    groups.push(cur);
    items.forEach((item, idx) => {
      if (isSection(item)) { cur = { section: item, idx, rows: [] }; groups.push(cur); }
      else cur.rows.push({ item, idx });
    });
    if (this.sort) {
      const { col, dir } = this.sort;
      const val = x => {
        const r = res(x.item);
        if (col === 'sym') return r.display;
        const q = quotes.get(qkey(r));
        return col === 'last' ? q?.price : col === 'chg' ? q?.change : q?.pct;
      };
      for (const g of groups) {
        g.rows.sort((a, b) => {
          const va = val(a), vb = val(b);
          if (va == null) return 1;
          if (vb == null) return -1;
          return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
        });
      }
    }
    const out = [];
    for (const g of groups) {
      if (g.section) out.push({ item: g.section, idx: g.idx });
      const collapsed = g.section && this.s.collapsed[`${this.list.id}|${sectionName(g.section)}`];
      if (!collapsed) out.push(...g.rows);
    }
    return out;
  }

  render() {
    const list = this.list;
    this.nameBtn.innerHTML = '';
    this.nameBtn.append(h('span', {}, list?.name || 'Watchlist'), h('span', { class: 'chev', html: ICONS.chevDown }));
    [...this.cols.children].forEach(c => {
      const k = c.className.match(/c-(\w+)/)[1];
      c.classList.toggle('sorted', this.sort?.col === k);
      c.dataset.dir = this.sort?.col === k ? (this.sort.dir > 0 ? '▲' : '▼') : '';
    });
    this.body.innerHTML = '';
    this.rows.clear();
    if (!list) return;
    if (!list.items.length) {
      this.body.append(h('div', { class: 'wl-empty' }, h('p', {}, 'This list is empty.'), h('button', { class: 'btn primary', onclick: () => this.addSymbolDialog() }, 'Add symbols')));
      return;
    }
    const current = this.getCurrent();
    for (const { item, idx } of this.visibleItems()) {
      if (isSection(item)) {
        const name = sectionName(item);
        const ck = `${list.id}|${name}`;
        const row = h('div', { class: `wl-section${this.s.collapsed[ck] ? ' collapsed' : ''}`, draggable: !this.sort,
          onclick: () => { this.s.collapsed[ck] = !this.s.collapsed[ck]; store.save(false); this.render(); },
          oncontextmenu: e => { e.preventDefault(); this.sectionMenu(e, idx); } },
        h('span', { class: 'chev', html: ICONS.chevDown }), h('span', { class: 'sec-name' }, name),
        h('button', { class: 'ibtn sm rm', title: 'Section options', html: ICONS.more, onclick: e => { e.stopPropagation(); this.sectionMenu(e, idx); } }));
        this.dnd(row, idx);
        this.body.append(row);
        continue;
      }
      const r = res(item);
      const row = h('div', { class: `wl-row${item === current ? ' active' : ''}`, draggable: !this.sort, dataset: { key: item },
        onclick: () => this.onSelect(item),
        oncontextmenu: e => { e.preventDefault(); this.rowMenu(e, idx); } },
      avatar(r, 18),
      h('span', { class: 'c-sym', title: r.desc || r.sym }, r.display),
      h('span', { class: 'c-last' }, '…'),
      h('span', { class: 'c-chg' }),
      h('span', { class: 'c-pct' }),
      h('button', { class: 'ibtn sm rm', title: 'Remove', html: ICONS.x, onclick: e => { e.stopPropagation(); this.removeAt(idx); } }));
      this.dnd(row, idx);
      this.rows.set(item, row);
      this.body.append(row);
    }
    this.updateQuotes();
    this.body.querySelector('.wl-row.active')?.scrollIntoView({ block: 'nearest' });
  }

  dnd(row, idx) {
    if (this.sort) return;
    row.addEventListener('dragstart', e => { this.dragIdx = idx; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); this.body.querySelectorAll('.drop-above,.drop-below').forEach(x => x.classList.remove('drop-above', 'drop-below')); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const below = e.clientY > r.top + r.height / 2;
      row.classList.toggle('drop-below', below);
      row.classList.toggle('drop-above', !below);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      const below = row.classList.contains('drop-below');
      row.classList.remove('drop-above', 'drop-below');
      const from = this.dragIdx;
      if (from == null || from === idx) return;
      const items = this.list.items;
      const [moved] = items.splice(from, 1);
      let to = idx + (below ? 1 : 0);
      if (from < to) to--;
      items.splice(to, 0, moved);
      this.dragIdx = null;
      this.save();
      this.render();
    });
  }

  // `onlyBinance`: optional Set of Binance symbols that changed (live ticks)
  updateQuotes(onlyBinance) {
    for (const [key, row] of this.rows) {
      const r = res(key);
      if (onlyBinance && !(r.src === 'binance' && onlyBinance.has(r.sym))) continue;
      const q = quotes.get(qkey(r));
      if (!q) continue;
      const last = row.children[2], chg = row.children[3], pct = row.children[4];
      if (q.missing) { last.textContent = 'n/a'; last.title = 'No quote data for this symbol'; continue; }
      const p = q.precision ?? autoPrecision(q.price);
      const prev = this.last.get(key);
      last.textContent = fmtPrice(q.price, p);
      if (prev != null && prev !== q.price) {
        last.classList.remove('flash-up', 'flash-down');
        void last.offsetWidth;
        last.classList.add(q.price > prev ? 'flash-up' : 'flash-down');
      }
      this.last.set(key, q.price);
      chg.textContent = fmtSigned(q.change, p);
      pct.textContent = fmtPct(q.pct);
      const c = upDownClass(q.change);
      chg.className = `c-chg ${c}`;
      pct.className = `c-pct ${c}`;
      row.classList.toggle('closed', q.open === false);
    }
  }

  setActive(key) {
    this.body.querySelectorAll('.wl-row.active').forEach(x => x.classList.remove('active'));
    const row = this.rows.get(key);
    if (row) { row.classList.add('active'); row.scrollIntoView({ block: 'nearest' }); }
  }

  // Next/previous symbol for keyboard navigation
  step(dir) {
    const syms = this.symbols();
    if (!syms.length) return;
    const i = syms.indexOf(this.getCurrent());
    const next = syms[(i + dir + syms.length) % syms.length];
    this.onSelect(next);
  }

  // ---------------------------------------------------------------- list operations
  has(key) { return this.list.items.includes(resolve(key).key); }

  add(key) {
    key = resolve(key).key;
    if (this.list.items.includes(key)) return false;
    this.list.items.push(key);
    this.save();
    this.render();
    return true;
  }

  removeAt(idx) {
    this.list.items.splice(idx, 1);
    this.save();
    this.render();
  }

  addSymbolDialog() {
    symbolSearch({ title: `Add symbol to “${this.list.name}”`, mode: 'add', inList: k => this.has(k), onPick: k => { if (!this.add(k)) toast(`${resolve(k).display} is already in the list`); } });
  }

  switchTo(id) {
    if (!this.s.lists[id]) return;
    this.s.activeList = id;
    this.s.recentLists = [id, ...this.s.recentLists.filter(x => x !== id && this.s.lists[x])].slice(0, 6);
    this.sort = null;
    this.save();
    this.render();
  }

  createList(name, items = []) {
    const id = uid();
    this.s.lists[id] = { id, name, items };
    this.s.listOrder.push(id);
    this.switchTo(id);
    return id;
  }

  async newList() {
    const name = await prompt('Create new list', { placeholder: 'List name' });
    if (name) this.createList(name);
  }

  async rename() {
    const name = await prompt('Rename list', { value: this.list.name });
    if (name) { this.list.name = name; this.save(); this.render(); }
  }

  async copy() {
    const name = await prompt('Make a copy', { value: `${this.list.name} (copy)` });
    if (name) this.createList(name, [...this.list.items]);
  }

  async addSection(atIdx) {
    const name = await prompt('Add section', { placeholder: 'Section name' });
    if (!name) return;
    if (atIdx == null) this.list.items.push('###' + name);
    else this.list.items.splice(atIdx, 0, '###' + name);
    this.save();
    this.render();
  }

  async clear() {
    if (await confirm('Clear list', `Remove all symbols from “${this.list.name}”?`, { okText: 'Clear', danger: true })) {
      this.list.items = [];
      this.save();
      this.render();
    }
  }

  async deleteList(id = this.list.id) {
    const l = this.s.lists[id];
    if (this.s.listOrder.length <= 1) { toast('You need at least one list'); return; }
    if (!(await confirm('Delete list', `Delete “${l.name}”? This cannot be undone.`, { okText: 'Delete', danger: true }))) return;
    delete this.s.lists[id];
    this.s.listOrder = this.s.listOrder.filter(x => x !== id);
    this.s.recentLists = this.s.recentLists.filter(x => x !== id);
    if (this.s.activeList === id) this.s.activeList = this.s.listOrder[0];
    this.save();
    this.render();
  }

  async upload() {
    const f = await pickFile('.txt,.csv,.json,text/plain,application/json');
    if (!f) return;
    try {
      const { name, items } = parseListText(f.text);
      if (!items.length) throw new Error('No symbols found');
      this.createList(name || f.name.replace(/\.(txt|csv|json)$/i, ''), items.map(x => (isSection(x) ? x : resolve(x).key)));
      toast(`Imported ${items.filter(x => !isSection(x)).length} symbols`, 'ok');
    } catch (e) {
      toast(`Import failed: ${e.message}`, 'error');
    }
  }

  downloadList() {
    download(`${this.list.name}.txt`, this.list.items.join(','));
  }

  shareLink() {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ n: this.list.name, i: this.list.items }))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `${location.origin}${location.pathname}#list=${payload}`;
    navigator.clipboard?.writeText(url).then(() => toast('Share link copied to clipboard', 'ok'), () => prompt('Share link', { value: url }));
  }

  openListDialog() {
    const input = h('input', { class: 'input', placeholder: 'Search lists' });
    const box = h('div', { class: 'lists' });
    const renderLists = () => {
      const q = input.value.toLowerCase();
      box.innerHTML = '';
      for (const id of this.s.listOrder) {
        const l = this.s.lists[id];
        if (!l || (q && !l.name.toLowerCase().includes(q))) continue;
        const n = l.items.filter(x => !isSection(x)).length;
        box.append(h('div', { class: `list-row${id === this.s.activeList ? ' active' : ''}`, onclick: () => { this.switchTo(id); m.close(); } },
          h('span', { html: ICONS.list, class: 'li-icon' }), h('span', { class: 'grow' }, l.name), h('span', { class: 'muted' }, `${n} symbols`),
          h('button', { class: 'ibtn sm', title: 'Delete', html: ICONS.trash, onclick: async e => { e.stopPropagation(); await this.deleteList(id); renderLists(); } })));
      }
    };
    input.addEventListener('input', renderLists);
    renderLists();
    const m = modal({ title: 'Watchlists', cls: 'small', body: h('div', { class: 'form' }, input, box),
      footer: [h('button', { class: 'btn', onclick: () => { m.close(); this.upload(); } }, 'Upload list…'), h('span', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: () => { m.close(); this.newList(); } }, 'Create new list')] });
    setTimeout(() => input.focus(), 20);
  }

  openMenu(anchor) {
    const recent = this.s.recentLists.filter(id => this.s.lists[id]).slice(0, 5);
    menu(anchor, [
      { label: 'Share list (copy link)', icon: 'share', onClick: () => this.shareLink() },
      { label: 'Make a copy…', icon: 'copy', onClick: () => this.copy() },
      { label: 'Rename', icon: 'pencil', onClick: () => this.rename() },
      { label: 'Add section', icon: 'section', onClick: () => this.addSection() },
      { label: 'Clear list', icon: 'broom', onClick: () => this.clear() },
      { label: 'Delete list', icon: 'trash', danger: true, onClick: () => this.deleteList() },
      { sep: true },
      { label: 'Create new list…', icon: 'newList', onClick: () => this.newList() },
      { label: 'Upload list…', icon: 'upload', onClick: () => this.upload() },
      { label: 'Download list', icon: 'download', onClick: () => this.downloadList() },
      { sep: true },
      { header: 'Recently used' },
      ...recent.map(id => ({ label: this.s.lists[id].name, active: id === this.s.activeList, onClick: () => this.switchTo(id) })),
      { sep: true },
      { label: 'Open list…', icon: 'folder', hint: 'Shift+W', onClick: () => this.openListDialog() },
    ], { cls: 'wl-menu' });
  }

  rowMenu(e, idx) {
    const key = this.list.items[idx];
    const others = this.s.listOrder.filter(id => id !== this.list.id && this.s.lists[id]);
    const anchor = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }), contains: () => false };
    menu(anchor, [
      { label: `Open ${res(key).display}`, onClick: () => this.onSelect(key) },
      { label: 'Add section above', icon: 'section', onClick: () => this.addSection(idx) },
      { label: 'Move to top', onClick: () => { this.list.items.splice(idx, 1); this.list.items.unshift(key); this.save(); this.render(); } },
      ...(others.length ? [{ sep: true }, { header: 'Add to list' }] : []),
      ...others.map(id => ({ label: this.s.lists[id].name, onClick: () => {
        const l = this.s.lists[id];
        if (!l.items.includes(key)) { l.items.push(key); this.save(); toast(`Added to ${l.name}`, 'ok'); }
      } })),
      { sep: true },
      { label: 'Remove', icon: 'x', danger: true, onClick: () => this.removeAt(idx) },
    ]);
  }

  sectionMenu(e, idx) {
    const anchor = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }), contains: () => false };
    menu(anchor, [
      { label: 'Rename section', icon: 'pencil', onClick: async () => {
        const name = await prompt('Rename section', { value: sectionName(this.list.items[idx]) });
        if (name) { this.list.items[idx] = '###' + name; this.save(); this.render(); }
      } },
      { label: 'Remove section (keep symbols)', icon: 'x', onClick: () => this.removeAt(idx) },
    ]);
  }
}
