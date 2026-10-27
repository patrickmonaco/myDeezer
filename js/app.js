// myDeezer — application monopage (aucune partie serveur)

import { CONFIG } from './config.js';
import { auth, api, fetchAll, AuthError } from './deezer.js';
import {
  $, $$, esc, toast, loadingHTML, ListView, plural, fmtNumber,
  fmtDuration, fmtLongDuration, fmtDate,
} from './ui.js';
import * as player from './player.js';

const view = $('#view');
const tracksById = new Map(); // pour retrouver un titre au clic sur « écouter »

/* ---------- Cache des réponses (le temps de la session) ---------- */

const cache = new Map();
async function cached(key, loader) {
  if (cache.has(key)) return cache.get(key);
  const p = loader();
  cache.set(key, p);
  try { return await p; } catch (e) { cache.delete(key); throw e; }
}
const forget = (...keys) => keys.forEach((k) => cache.delete(k));

const getMe = () => cached('me', () => api('/user/me'));

/* ---------- Routeur ---------- */

const routes = [
  { re: /^#\/profile$/, nav: 'profile', fn: viewProfile },
  { re: /^#\/playlists$/, nav: 'playlists', fn: viewPlaylists },
  { re: /^#\/playlist\/(\d+)$/, nav: 'playlists', fn: viewPlaylist },
  { re: /^#\/favorites$/, nav: 'favorites', fn: viewFavorites },
];

let renderSeq = 0;
async function render() {
  const hash = location.hash || '#/playlists';
  const route = routes.find((r) => r.re.test(hash));
  if (!route) { location.replace('#/playlists'); return; }

  const my = ++renderSeq;
  const ctx = { current: () => my === renderSeq };
  $$('#sidebar .nav-link').forEach((a) => a.classList.toggle('active', a.dataset.nav === route.nav));
  bootstrap.Offcanvas.getInstance($('#sidebar'))?.hide();
  window.scrollTo(0, 0);

  try {
    await route.fn(ctx, ...hash.match(route.re).slice(1));
  } catch (e) {
    if (!ctx.current()) return;
    if (e instanceof AuthError) { logout(e.message, 'warning'); return; }
    console.error(e);
    view.innerHTML = `<div class="view-error alert alert-danger d-flex align-items-start gap-3">
      <i class="bi bi-exclamation-triangle fs-4"></i>
      <div><div class="fw-semibold mb-1">Chargement impossible</div><div>${esc(e.message)}</div>
      <button class="btn btn-sm btn-outline-danger mt-3" id="retry"><i class="bi bi-arrow-clockwise me-1"></i>Réessayer</button></div></div>`;
    $('#retry').addEventListener('click', render);
  }
}

function viewHead({ title, subtitle = '', icon, refresh, back }) {
  return `<header class="view-head">
    <div>
      ${back ? `<a class="back-link" href="${back.href}"><i class="bi bi-arrow-left"></i> ${esc(back.label)}</a>` : ''}
      <h1><i class="bi ${icon}"></i>${esc(title)}</h1>
      <p class="view-sub" id="view-sub">${subtitle}</p>
    </div>
    ${refresh ? `<button class="btn btn-sm btn-outline-secondary" id="refresh" title="Recharger depuis Deezer">
      <i class="bi bi-arrow-clockwise"></i><span class="d-none d-sm-inline ms-1">Actualiser</span></button>` : ''}
  </header>`;
}

function bindRefresh(keys) {
  $('#refresh')?.addEventListener('click', () => { forget(...keys); render(); });
}

function progress(ctx, label) {
  return (n, total) => {
    if (!ctx.current()) return;
    const el = $('.loading-text', view);
    if (el) el.textContent = total ? `${label} ${fmtNumber(n)} / ${fmtNumber(total)}` : `${label} ${fmtNumber(n)}`;
  };
}

/* ---------- Vue : playlists ---------- */

async function viewPlaylists(ctx) {
  view.innerHTML = viewHead({ title: 'Mes playlists', icon: 'bi-collection-play', refresh: true })
    + `<div id="lv">${loadingHTML('Chargement des playlists…')}</div>`;
  bindRefresh(['playlists']);

  const { items } = await cached('playlists',
    () => fetchAll('/user/me/playlists', { onProgress: progress(ctx, 'Playlists chargées :') }));
  if (!ctx.current()) return;

  const me = await getMe().catch(() => null);
  const mine = items.filter((p) => !me || p.creator?.id === me.id).length;
  $('#view-sub').textContent = `${plural(items.length, 'playlist', 'playlists')} · ${plural(mine, 'créée', 'créées')} par vous`;

  new ListView($('#lv'), {
    key: 'playlists',
    items,
    noun: ['playlist', 'playlists'],
    placeholder: 'Rechercher une playlist ou un créateur…',
    emptyText: 'Aucune playlist dans votre bibliothèque.',
    searchText: (p) => `${p.title} ${p.creator?.name || ''}`,
    render: (slice) => `<div class="row row-cols-2 row-cols-sm-3 row-cols-md-4 row-cols-xl-5 row-cols-xxl-6 g-3 g-lg-4">
      ${slice.map((p) => playlistCard(p, me)).join('')}</div>`,
  });
}

function playlistCard(p, me) {
  const other = me && p.creator && p.creator.id !== me.id;
  const flags = [
    p.is_loved_track ? '<span class="pl-flag loved" title="Coups de cœur"><i class="bi bi-heart-fill"></i></span>' : '',
    p.collaborative ? '<span class="pl-flag" title="Collaborative"><i class="bi bi-people-fill"></i></span>' : '',
    p.public === false ? '<span class="pl-flag" title="Privée"><i class="bi bi-lock-fill"></i></span>' : '',
  ].join('');
  return `<div class="col"><a class="pl-card" href="#/playlist/${p.id}">
    <div class="pl-cover">
      <img src="${esc(p.picture_medium)}" srcset="${esc(p.picture_medium)} 250w, ${esc(p.picture_big)} 500w"
           sizes="(min-width: 1200px) 200px, 45vw" alt="" loading="lazy">
      <div class="pl-flags">${flags}</div>
      <span class="pl-open"><i class="bi bi-arrow-right"></i></span>
    </div>
    <div class="pl-title" title="${esc(p.title)}">${esc(p.title)}</div>
    <div class="pl-meta">${plural(p.nb_tracks || 0, 'titre', 'titres')}${other ? ` · ${esc(p.creator.name)}` : ''}</div>
  </a></div>`;
}

/* ---------- Vue : détail d'une playlist ---------- */

async function viewPlaylist(ctx, id) {
  view.innerHTML = viewHead({
    title: 'Playlist', icon: 'bi-music-note-list', refresh: true,
    back: { href: '#/playlists', label: 'Mes playlists' },
  }) + `<div id="pl-head"></div><div id="lv">${loadingHTML('Chargement des titres…')}</div>`;
  bindRefresh([`pl:${id}`, `plt:${id}`]);

  const [pl, { items }] = await Promise.all([
    cached(`pl:${id}`, () => api(`/playlist/${id}`)),
    cached(`plt:${id}`, () => fetchAll(`/playlist/${id}/tracks`, { onProgress: progress(ctx, 'Titres chargés :') })),
  ]);
  if (!ctx.current()) return;

  $('.view-head h1').innerHTML = `<i class="bi bi-music-note-list"></i>${esc(pl.title)}`;
  document.title = `${pl.title} · myDeezer`;
  const total = items.reduce((s, t) => s + (t.duration || 0), 0);
  $('#view-sub').textContent = `${plural(items.length, 'titre', 'titres')} · ${fmtLongDuration(total)}`;
  $('#pl-head').innerHTML = `<div class="pl-hero">
    <img src="${esc(pl.picture_big || pl.picture_medium)}" alt="" class="pl-hero-img">
    <div class="pl-hero-body">
      ${pl.description ? `<p class="pl-desc">${esc(pl.description)}</p>` : ''}
      <dl class="pl-facts">
        ${pl.creator ? `<div><dt>Créée par</dt><dd>${esc(pl.creator.name)}</dd></div>` : ''}
        ${pl.creation_date ? `<div><dt>Création</dt><dd>${fmtDate(pl.creation_date)}</dd></div>` : ''}
        <div><dt>Visibilité</dt><dd>${pl.public === false ? 'Privée' : 'Publique'}${pl.collaborative ? ' · collaborative' : ''}</dd></div>
        ${pl.fans != null ? `<div><dt>Fans</dt><dd>${fmtNumber(pl.fans)}</dd></div>` : ''}
      </dl>
      ${pl.link ? `<a class="btn btn-sm btn-outline-secondary" href="${esc(pl.link)}" target="_blank" rel="noopener">
        <i class="bi bi-box-arrow-up-right me-1"></i>Ouvrir dans Deezer</a>` : ''}
    </div></div>`;

  mountTracks($('#lv'), items, { key: 'playlist-tracks', exportName: `playlist-${slug(pl.title)}` });
}

/* ---------- Vue : coups de cœur ---------- */

async function viewFavorites(ctx) {
  view.innerHTML = viewHead({ title: 'Coups de cœur', icon: 'bi-heart', refresh: true })
    + `<div id="lv">${loadingHTML('Chargement des coups de cœur…')}</div>`;
  bindRefresh(['favorites']);

  const { items } = await cached('favorites',
    () => fetchAll('/user/me/tracks', { onProgress: progress(ctx, 'Titres chargés :') }));
  if (!ctx.current()) return;

  const total = items.reduce((s, t) => s + (t.duration || 0), 0);
  $('#view-sub').textContent = `${plural(items.length, 'titre', 'titres')} · ${fmtLongDuration(total)} d’écoute`;
  mountTracks($('#lv'), items, { key: 'favorites', exportName: 'coups-de-coeur', emptyText: 'Aucun coup de cœur pour le moment.' });
}

/* ---------- Liste de titres (partagée) ---------- */

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const TRACK_SORTS = {
  title: {
    first: 'asc', asc: 'Titre (A → Z)', desc: 'Titre (Z → A)',
    cmp: (a, b) => collator.compare(a.title || '', b.title || ''),
  },
  added: {
    first: 'desc', desc: 'Ajout (plus récents)', asc: 'Ajout (plus anciens)',
    cmp: (a, b) => (a.time_add || 0) - (b.time_add || 0),
  },
  duration: {
    first: 'asc', asc: 'Durée (croissante)', desc: 'Durée (décroissante)',
    cmp: (a, b) => (a.duration || 0) - (b.duration || 0),
  },
};

function mountTracks(root, items, { key, exportName, emptyText }) {
  items.forEach((t) => tracksById.set(String(t.id), t));
  const sorts = { ...TRACK_SORTS };
  if (!items.some((t) => t.time_add)) delete sorts.added; // pas de date d'ajout dans les playlists
  new ListView(root, {
    key,
    items,
    sorts,
    noun: ['titre', 'titres'],
    placeholder: 'Rechercher un titre, un artiste, un album…',
    emptyText: emptyText || 'Aucun titre.',
    searchText: (t) => `${t.title} ${t.artist?.name || ''} ${t.album?.title || ''}`,
    actions: `<div class="dropdown">
      <button class="btn btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
        <i class="bi bi-download"></i><span class="d-none d-sm-inline ms-1">Exporter</span></button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li><h6 class="dropdown-header export-scope">Liste complète</h6></li>
        <li><a class="dropdown-item" href="#" data-lv-action="export-json"><i class="bi bi-filetype-json me-2"></i>JSON</a></li>
        <li><a class="dropdown-item" href="#" data-lv-action="export-csv"><i class="bi bi-filetype-csv me-2"></i>CSV (Excel)</a></li>
      </ul></div>`,
    onAction: (action, lv) => {
      const rows = lv.filtered.map(flattenTrack);
      if (!rows.length) { toast('Rien à exporter.'); return; }
      const suffix = lv.query ? '-filtre' : '';
      const stamp = new Date().toISOString().slice(0, 10);
      if (action === 'export-json') {
        download(`mydeezer-${exportName}${suffix}-${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json');
      } else {
        download(`mydeezer-${exportName}${suffix}-${stamp}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
      }
      toast(`${plural(rows.length, 'titre exporté', 'titres exportés')}.`, 'success');
    },
    onRender: (lv) => {
      const scope = $('.export-scope', lv.root);
      if (scope) {
        scope.textContent = lv.query
          ? `Résultat de la recherche (${plural(lv.filtered.length, 'titre', 'titres')})`
          : `Liste complète (${plural(lv.items.length, 'titre', 'titres')})`;
      }
      player.sync();
    },
    render: trackTable,
  });
}

function trackTable(slice, offset, lv) {
  const showAdded = slice.some((t) => t.time_add);
  return `<div class="table-responsive track-wrap"><table class="table table-hover align-middle mb-0 track-table">
    <thead><tr>
      <th class="col-num">#</th><th class="col-play"></th><th${lv.ariaSort('title')}>${lv.sortHeader('title', 'Titre')}</th>
      <th class="d-none d-md-table-cell">Album</th>
      ${showAdded ? `<th class="d-none d-lg-table-cell"${lv.ariaSort('added')}>${lv.sortHeader('added', 'Ajouté le')}</th>` : ''}
      <th class="text-end col-dur"${lv.ariaSort('duration')}>${lv.sortHeader('duration', 'Durée', '<i class="bi bi-clock"></i>')}</th><th class="col-link"></th>
    </tr></thead>
    <tbody>${slice.map((t, i) => `<tr>
      <td class="col-num">${offset + i + 1}</td>
      <td class="col-play">
        <button type="button" class="play-btn" data-play="${t.id}" ${t.preview ? '' : 'disabled title="Pas d’extrait"'}
                aria-label="Écouter l’extrait">
          <img src="${esc(t.album?.cover_small)}" alt="" loading="lazy">
          <i class="play-icon bi bi-play-fill"></i>
        </button>
      </td>
      <td class="col-title">
        <div class="t-title">${esc(t.title)}${t.explicit_lyrics ? ' <span class="badge-explicit" title="Contenu explicite">E</span>' : ''}</div>
        <div class="t-artist">${esc(t.artist?.name)}<span class="d-md-none"> · ${esc(t.album?.title)}</span></div>
      </td>
      <td class="d-none d-md-table-cell t-album">${esc(t.album?.title)}</td>
      ${showAdded ? `<td class="d-none d-lg-table-cell t-date">${fmtDate(t.time_add)}</td>` : ''}
      <td class="text-end t-dur">${fmtDuration(t.duration)}</td>
      <td class="col-link">${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener" class="t-ext" title="Ouvrir dans Deezer"
        aria-label="Ouvrir dans Deezer"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

view.addEventListener('click', (e) => {
  const b = e.target.closest('[data-play]');
  if (!b) return;
  const t = tracksById.get(b.dataset.play);
  if (t) player.toggle(t);
});

/* ---------- Export ---------- */

function flattenTrack(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist?.name ?? '',
    artist_id: t.artist?.id ?? '',
    album: t.album?.title ?? '',
    album_id: t.album?.id ?? '',
    duration: t.duration ?? '',
    duration_hms: fmtDuration(t.duration),
    explicit: !!t.explicit_lyrics,
    rank: t.rank ?? '',
    added_at: t.time_add ? new Date(t.time_add * 1000).toISOString() : '',
    link: t.link ?? '',
    preview: t.preview ?? '',
  };
}

// Séparateur « ; » + BOM UTF-8 : s'ouvre directement dans Excel en français
function toCSV(rows) {
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n');
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s) => String(s || 'playlist').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'playlist';

/* ---------- Vue : profil ---------- */

const STATS = [
  { key: 'playlists', label: 'Playlists', icon: 'bi-collection-play', href: '#/playlists' },
  { key: 'tracks', label: 'Coups de cœur', icon: 'bi-heart', href: '#/favorites' },
  { key: 'artists', label: 'Artistes favoris', icon: 'bi-mic', tab: 'artists' },
  { key: 'albums', label: 'Albums favoris', icon: 'bi-disc', tab: 'albums' },
  { key: 'followings', label: 'Abonnements', icon: 'bi-person-plus' },
  { key: 'followers', label: 'Abonnés', icon: 'bi-people' },
];

async function viewProfile(ctx) {
  view.innerHTML = viewHead({ title: 'Mon profil', icon: 'bi-person-circle', refresh: true })
    + `<div id="profile">${loadingHTML('Chargement du profil…')}</div>`;
  bindRefresh(['me', 'artists', 'albums', ...STATS.map((s) => `count:${s.key}`)]);

  const me = await getMe();
  if (!ctx.current()) return;
  fillSidebarUser(me);

  const counts = await Promise.allSettled(STATS.map((s) => cached(`count:${s.key}`,
    () => api(`/user/me/${s.key}`, { limit: 1 }).then((d) => d.total ?? (d.data || []).length))));
  if (!ctx.current()) return;

  const country = me.country ? countryLabel(me.country) : '';
  const fullName = [me.firstname, me.lastname].filter(Boolean).join(' ');
  $('#view-sub').textContent = 'Informations de votre compte Deezer';

  $('#profile').innerHTML = `
    <section class="profile-card">
      <img class="profile-avatar" src="${esc(me.picture_big || me.picture_medium)}" alt="">
      <div class="profile-main">
        <h2>${esc(me.name)}</h2>
        ${fullName && fullName !== me.name ? `<div class="profile-fullname">${esc(fullName)}</div>` : ''}
        <dl class="profile-facts">
          ${me.email ? `<div><dt><i class="bi bi-envelope"></i>E-mail</dt><dd>${esc(me.email)}</dd></div>` : ''}
          ${country ? `<div><dt><i class="bi bi-globe2"></i>Pays</dt><dd>${country}</dd></div>` : ''}
          ${me.lang ? `<div><dt><i class="bi bi-translate"></i>Langue</dt><dd>${esc(me.lang.toUpperCase())}</dd></div>` : ''}
          ${me.inscription_date ? `<div><dt><i class="bi bi-calendar3"></i>Inscrit depuis</dt><dd>${fmtDate(me.inscription_date, { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>` : ''}
          <div><dt><i class="bi bi-hash"></i>Identifiant</dt><dd><code>${esc(me.id)}</code></dd></div>
        </dl>
        ${me.link ? `<a class="btn btn-sm btn-outline-secondary" href="${esc(me.link)}" target="_blank" rel="noopener">
          <i class="bi bi-box-arrow-up-right me-1"></i>Voir mon profil sur Deezer</a>` : ''}
      </div>
    </section>

    <section class="stats-grid">
      ${STATS.map((s, i) => {
        const r = counts[i];
        const v = r.status === 'fulfilled' ? fmtNumber(r.value) : '—';
        const tag = s.href ? `a href="${s.href}"` : s.tab ? `button type="button" data-tab="${s.tab}"` : 'div';
        const end = s.href ? 'a' : s.tab ? 'button' : 'div';
        return `<${tag} class="stat${s.href || s.tab ? ' stat-link' : ''}">
          <i class="bi ${s.icon}"></i><span class="stat-value">${v}</span><span class="stat-label">${s.label}</span></${end}>`;
      }).join('')}
    </section>

    <section class="profile-lists">
      <ul class="nav nav-pills mb-3" role="tablist">
        <li class="nav-item"><button class="nav-link active" data-tab="artists" type="button"><i class="bi bi-mic me-1"></i>Artistes favoris</button></li>
        <li class="nav-item"><button class="nav-link" data-tab="albums" type="button"><i class="bi bi-disc me-1"></i>Albums favoris</button></li>
      </ul>
      <div id="profile-list"></div>
    </section>`;

  const showTab = (tab) => {
    $$('.profile-lists .nav-link').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    loadProfileTab(ctx, tab);
  };
  $('#profile').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    showTab(b.dataset.tab);
    if (b.classList.contains('stat')) $('.profile-lists').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  showTab('artists');
}

let tabSeq = 0;
async function loadProfileTab(ctx, tab) {
  const my = ++tabSeq;
  const root = $('#profile-list');
  root.innerHTML = loadingHTML(tab === 'artists' ? 'Chargement des artistes…' : 'Chargement des albums…');
  try {
    const { items } = await cached(tab, () => fetchAll(`/user/me/${tab}`));
    if (!ctx.current() || my !== tabSeq) return;
    if (tab === 'artists') {
      new ListView(root, {
        key: 'artists', items, noun: ['artiste', 'artistes'],
        placeholder: 'Rechercher un artiste…', emptyText: 'Aucun artiste favori.',
        searchText: (a) => a.name,
        render: (slice) => `<div class="row row-cols-2 row-cols-sm-3 row-cols-md-4 row-cols-xl-6 g-3">
          ${slice.map((a) => `<div class="col"><a class="artist-card" href="${esc(a.link)}" target="_blank" rel="noopener">
            <img src="${esc(a.picture_medium)}" alt="" loading="lazy">
            <div class="pl-title">${esc(a.name)}</div>
            <div class="pl-meta">${a.nb_fan != null ? `${fmtNumber(a.nb_fan)} fans` : 'Artiste'}</div>
          </a></div>`).join('')}</div>`,
      });
    } else {
      new ListView(root, {
        key: 'albums', items, noun: ['album', 'albums'],
        placeholder: 'Rechercher un album ou un artiste…', emptyText: 'Aucun album favori.',
        searchText: (a) => `${a.title} ${a.artist?.name || ''}`,
        render: (slice) => `<div class="row row-cols-2 row-cols-sm-3 row-cols-md-4 row-cols-xl-6 g-3">
          ${slice.map((a) => `<div class="col"><a class="pl-card" href="${esc(a.link)}" target="_blank" rel="noopener">
            <div class="pl-cover"><img src="${esc(a.cover_medium)}" alt="" loading="lazy"></div>
            <div class="pl-title" title="${esc(a.title)}">${esc(a.title)}</div>
            <div class="pl-meta">${esc(a.artist?.name || '')}${a.release_date ? ` · ${a.release_date.slice(0, 4)}` : ''}</div>
          </a></div>`).join('')}</div>`,
      });
    }
  } catch (e) {
    if (e instanceof AuthError) { logout(e.message, 'warning'); return; }
    if (my === tabSeq) root.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
  }
}

function countryLabel(code) {
  const flag = code.length === 2
    ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
  let name = code;
  try { name = new Intl.DisplayNames(['fr'], { type: 'region' }).of(code.toUpperCase()) || code; } catch { /* ignore */ }
  return `${flag} ${esc(name)}`;
}

/* ---------- Coquille de l'application ---------- */

function fillSidebarUser(me) {
  $('#side-user').innerHTML = `<img src="${esc(me.picture_small || me.picture)}" alt="">
    <div class="min-w-0"><div class="side-user-name">${esc(me.name)}</div>
    <div class="side-user-sub">${esc(me.email || 'Compte Deezer')}</div></div>`;
}

function showLogin(message, variant = 'info') {
  player.stop();
  document.title = 'myDeezer';
  $('#app-shell').classList.add('d-none');
  $('#login-screen').classList.remove('d-none');
  const box = $('#login-message');
  box.className = message ? `alert alert-${variant} small` : 'd-none';
  box.textContent = message || '';
  $('#redirect-uri').textContent = auth.redirectUri();
  $('#app-id').textContent = CONFIG.APP_ID;
}

function showApp() {
  $('#login-screen').classList.add('d-none');
  $('#app-shell').classList.remove('d-none');
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/playlists');
  render();
  getMe().then(fillSidebarUser).catch((e) => { if (e instanceof AuthError) logout(e.message, 'warning'); });
}

function logout(message = 'Vous êtes déconnecté.', variant = 'info') {
  auth.clear();
  cache.clear();
  tracksById.clear();
  $('#side-user').innerHTML = '';
  history.replaceState(null, '', location.pathname);
  showLogin(message, variant);
}

function initTheme() {
  const apply = (t) => {
    document.documentElement.dataset.bsTheme = t;
    $('#theme-toggle i').className = `bi ${t === 'dark' ? 'bi-sun' : 'bi-moon-stars'}`;
    $('#theme-toggle span').textContent = t === 'dark' ? 'Thème clair' : 'Thème sombre';
    $('meta[name="theme-color"]').content = t === 'dark' ? '#13101c' : '#f6f4fb';
  };
  apply(document.documentElement.dataset.bsTheme || 'dark');
  $('#theme-toggle').addEventListener('click', () => {
    const t = document.documentElement.dataset.bsTheme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('mydeezer.theme', t); } catch { /* ignore */ }
    apply(t);
  });
}

function initInstall() {
  let deferred = null;
  const btn = $('#install-btn');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; btn.classList.remove('d-none'); });
  window.addEventListener('appinstalled', () => btn.classList.add('d-none'));
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    btn.classList.add('d-none');
  });
}

/* ---------- Démarrage ---------- */

function boot() {
  initTheme();
  initInstall();
  player.initPlayer();

  $('#login-btn').addEventListener('click', () => auth.login());
  $('#logout-btn').addEventListener('click', () => logout());

  // Raccourci « / » : rechercher dans la liste affichée
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select')) {
      const input = $('.lv-search', view);
      if (input) { e.preventDefault(); input.focus(); }
    }
  });

  window.addEventListener('hashchange', () => { if (auth.get()) render(); });

  const redirect = auth.consumeRedirect();
  if (auth.get()) showApp();
  else if (redirect?.error) {
    showLogin(redirect.error === 'user_denied'
      ? 'Autorisation refusée sur Deezer.'
      : `Connexion refusée par Deezer (${redirect.error}).`, 'warning');
  } else showLogin();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker :', e));
  }
}

boot();
