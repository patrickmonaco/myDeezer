// Utilitaires d'affichage et composant de liste (recherche + pagination)

import { CONFIG } from './config.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const normalize = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const fmtNumber = (n) => Number(n || 0).toLocaleString('fr-FR');

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

export function fmtLongDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${fmtNumber(h)} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export function fmtDate(v, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!v) return '';
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', opts);
}

export const plural = (n, one, many) => `${fmtNumber(n)} ${n > 1 ? many : one}`;

export const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#2b2540"/>' +
  '<circle cx="43" cy="66" r="10" fill="#8f84ad"/><rect x="48" y="28" width="5" height="39" fill="#8f84ad"/>' +
  '<path d="M48 28l22-7v11l-22 7z" fill="#8f84ad"/></svg>');

// Image de remplacement pour toute image qui ne se charge pas
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img?.tagName === 'IMG' && !img.dataset.fallback) {
    img.dataset.fallback = '1';
    img.removeAttribute('srcset');
    img.src = PLACEHOLDER;
  }
}, true);

export function toast(message, variant = 'dark') {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${variant} border-0`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(message)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fermer"></button></div>`;
  host.appendChild(el);
  const t = bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}

export function loadingHTML(text = 'Chargement…') {
  return `<div class="loading-state"><div class="spinner-border" role="status" aria-hidden="true"></div>
    <div class="loading-text">${esc(text)}</div></div>`;
}

/* ---------- ListView : recherche simple + pagination ---------- */

const sizeMemory = new Map(); // taille de page choisie, par liste, le temps de la session
const sortMemory = new Map(); // tri choisi, par liste, le temps de la session

export class ListView {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   *   key, items, render(slice, offset), searchText(item), placeholder,
   *   noun: ['titre','titres'], actions (html), onAction(name, lv), onRender(lv), emptyText,
   *   sorts: { cle: { cmp(a, b), first: 'asc'|'desc', asc: 'libellé', desc: 'libellé' } }
   */
  constructor(root, o) {
    this.root = root;
    this.o = o;
    this.items = o.items || [];
    this.keys = this.items.map((it) => normalize(o.searchText(it)));
    this.matched = this.items;   // résultat de la recherche, ordre d'origine
    this.filtered = this.items;  // résultat de la recherche, trié
    this.query = '';
    const saved = sortMemory.get(o.key);
    this.sort = saved && o.sorts?.[saved.key] ? saved : null;
    this.applySort();
    this.page = 1;
    this.size = sizeMemory.get(o.key) || CONFIG.DEFAULT_PAGE_SIZE;
    this.mount();
  }

  mount() {
    this.root.innerHTML = `
      <div class="lv-toolbar">
        <label class="lv-search-wrap">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input type="search" class="form-control lv-search" placeholder="${esc(this.o.placeholder || 'Rechercher…')}"
                 aria-label="Rechercher" autocomplete="off" spellcheck="false">
          <kbd class="lv-kbd d-none d-md-inline" title="Raccourci clavier">/</kbd>
        </label>
        <div class="lv-actions">${this.sortSelectHTML()}${this.o.actions || ''}</div>
      </div>
      <div class="lv-pager lv-pager-top"></div>
      <div class="lv-body"></div>
      <div class="lv-pager lv-pager-bottom"></div>`;
    this.body = $('.lv-body', this.root);
    this.pagers = $$('.lv-pager', this.root);
    this.input = $('.lv-search', this.root);

    this.input.addEventListener('input', debounce(() => this.search(this.input.value), 150));
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.input.value = ''; this.search(''); } });

    this.root.addEventListener('click', (e) => {
      const pg = e.target.closest('[data-page]');
      if (pg && this.root.contains(pg)) {
        e.preventDefault();
        if (!pg.closest('.disabled, .active')) this.go(Number(pg.dataset.page), !!pg.closest('.lv-pager-bottom'));
        return;
      }
      const so = e.target.closest('[data-sort]');
      if (so && this.root.contains(so)) { e.preventDefault(); this.toggleSort(so.dataset.sort); return; }
      const act = e.target.closest('[data-lv-action]');
      if (act) { e.preventDefault(); this.o.onAction?.(act.dataset.lvAction, this); }
    });
    this.root.addEventListener('change', (e) => {
      if (e.target.matches('.lv-size')) this.setSize(Number(e.target.value));
      if (e.target.matches('.lv-sort-select')) {
        const [key, dir] = e.target.value.split(':');
        this.setSort(key ? { key, dir } : null);
      }
    });
    this.update();
  }

  search(q) {
    this.query = q.trim();
    const terms = normalize(this.query).split(/\s+/).filter(Boolean);
    this.matched = terms.length
      ? this.items.filter((_, i) => terms.every((t) => this.keys[i].includes(t)))
      : this.items;
    this.applySort();
    this.page = 1;
    this.update();
  }

  /* ----- Tri ----- */

  applySort() {
    const def = this.sort && this.o.sorts?.[this.sort.key];
    if (!def) { this.filtered = this.matched; return; }
    const k = this.sort.dir === 'desc' ? -1 : 1;
    this.filtered = [...this.matched].sort((a, b) => k * def.cmp(a, b)); // tri stable
  }

  setSort(sort) {
    this.sort = sort;
    if (sort) sortMemory.set(this.o.key, sort); else sortMemory.delete(this.o.key);
    this.applySort();
    this.page = 1;
    this.update();
  }

  // 1er clic : sens naturel de la colonne · 2e : sens inverse · 3e : ordre d'origine
  toggleSort(key) {
    const def = this.o.sorts?.[key];
    if (!def) return;
    const first = def.first || 'asc';
    const other = first === 'asc' ? 'desc' : 'asc';
    if (this.sort?.key !== key) this.setSort({ key, dir: first });
    else if (this.sort.dir === first) this.setSort({ key, dir: other });
    else this.setSort(null);
  }

  // En-tête de colonne cliquable (à utiliser dans render)
  sortHeader(key, label, inner = esc(label)) {
    const def = this.o.sorts?.[key];
    if (!def) return inner;
    const active = this.sort?.key === key;
    const dir = active ? this.sort.dir : null;
    const icon = !active ? 'bi-chevron-expand' : dir === 'asc' ? 'bi-caret-up-fill' : 'bi-caret-down-fill';
    const hint = !active ? `Trier : ${def[def.first || 'asc']}`
      : this.sort.dir === (def.first || 'asc') ? `Trier : ${def[dir === 'asc' ? 'desc' : 'asc']}` : 'Revenir à l’ordre d’origine';
    return `<button type="button" class="th-sort${active ? ' active' : ''}" data-sort="${key}" title="${esc(hint)}"
      aria-label="${esc(label)} — ${esc(hint)}">${inner}<i class="bi ${icon}"></i></button>`;
  }

  ariaSort(key) {
    if (this.sort?.key !== key) return '';
    return ` aria-sort="${this.sort.dir === 'asc' ? 'ascending' : 'descending'}"`;
  }

  // Sélecteur de tri pour petits écrans (où certaines colonnes sont masquées)
  sortSelectHTML() {
    const sorts = this.o.sorts;
    if (!sorts) return '';
    const cur = this.sort ? `${this.sort.key}:${this.sort.dir}` : '';
    const opt = (v, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
    const opts = [opt('', 'Ordre d’origine')];
    for (const [key, d] of Object.entries(sorts)) {
      const first = d.first || 'asc';
      const second = first === 'asc' ? 'desc' : 'asc';
      opts.push(opt(`${key}:${first}`, d[first]), opt(`${key}:${second}`, d[second]));
    }
    return `<select class="form-select lv-sort-select d-lg-none" aria-label="Trier">${opts.join('')}</select>`;
  }

  go(page, fromBottom) {
    this.page = page;
    this.update();
    if (fromBottom) this.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  setSize(size) {
    const first = (this.page - 1) * this.size;
    this.size = size;
    sizeMemory.set(this.o.key, size);
    this.page = Math.floor(first / size) + 1; // garde le premier élément visible
    this.update();
  }

  update() {
    const n = this.filtered.length;
    const pages = Math.max(1, Math.ceil(n / this.size));
    this.page = Math.min(Math.max(1, this.page), pages);
    const start = (this.page - 1) * this.size;
    const slice = this.filtered.slice(start, start + this.size);

    if (n) this.body.innerHTML = this.o.render(slice, start, this);
    else {
      const msg = this.query
        ? `Aucun résultat pour « ${esc(this.query)} ».`
        : esc(this.o.emptyText || 'Cette liste est vide.');
      this.body.innerHTML = `<div class="lv-empty"><i class="bi bi-inbox"></i><p>${msg}</p></div>`;
    }

    const html = this.pagerHTML(n, pages, start, slice.length);
    this.pagers.forEach((p) => { p.innerHTML = html; });
    this.pagers[1].hidden = pages <= 1 && slice.length <= 10;
    const sel = $('.lv-sort-select', this.root);
    if (sel) sel.value = this.sort ? `${this.sort.key}:${this.sort.dir}` : '';
    this.o.onRender?.(this);
  }

  pagerHTML(n, pages, start, count) {
    const [one, many] = this.o.noun || ['élément', 'éléments'];
    const range = n ? `${fmtNumber(start + 1)}–${fmtNumber(start + count)}` : '0';
    const of = `sur ${plural(n, one, many)}`;
    const filtered = this.matched !== this.items ? ` <span class="text-body-tertiary">(filtré parmi ${fmtNumber(this.items.length)})</span>` : '';
    const opts = CONFIG.PAGE_SIZES.map((s) => `<option value="${s}"${s === this.size ? ' selected' : ''}>${s}</option>`).join('');

    const p = this.page;
    const nums = new Set([1, pages, p - 1, p, p + 1, p - 2, p + 2].filter((x) => x >= 1 && x <= pages));
    const list = [...nums].sort((a, b) => a - b);
    let items = '';
    let prev = 0;
    for (const x of list) {
      if (x - prev > 1) items += '<li class="page-item disabled d-none d-sm-block"><span class="page-link">…</span></li>';
      items += `<li class="page-item${x === p ? ' active' : ' d-none d-sm-block'}"${x === p ? ' aria-current="page"' : ''}>
        <a class="page-link" href="#" data-page="${x}">${x}</a></li>`;
      prev = x;
    }
    const dis = (c) => (c ? ' disabled' : '');

    return `
      <div class="lv-info">
        <select class="form-select form-select-sm lv-size" aria-label="Éléments par page">${opts}</select>
        <span>par page · <strong>${range}</strong> ${of}${filtered}</span>
      </div>
      <nav aria-label="Pagination">
        <ul class="pagination pagination-sm mb-0">
          <li class="page-item${dis(p === 1)}"><a class="page-link" href="#" data-page="1" aria-label="Première page"><i class="bi bi-chevron-double-left"></i></a></li>
          <li class="page-item${dis(p === 1)}"><a class="page-link" href="#" data-page="${p - 1}" aria-label="Page précédente"><i class="bi bi-chevron-left"></i></a></li>
          ${items}
          <li class="page-item${dis(p === pages)}"><a class="page-link" href="#" data-page="${p + 1}" aria-label="Page suivante"><i class="bi bi-chevron-right"></i></a></li>
          <li class="page-item${dis(p === pages)}"><a class="page-link" href="#" data-page="${pages}" aria-label="Dernière page"><i class="bi bi-chevron-double-right"></i></a></li>
        </ul>
      </nav>`;
  }
}
