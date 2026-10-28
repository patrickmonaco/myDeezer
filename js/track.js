// Fiche détaillée d'un titre (fenêtre modale)
// Combine /track/{id} (ISRC, BPM, gain, contributeurs…) et /album/{id} (label, genres, UPC…)

import { api, AuthError } from './deezer.js';
import { $, esc, toast, loadingHTML, fmtNumber, fmtDuration, fmtDate } from './ui.js';
import * as player from './player.js';

const details = new Map(); // cache des réponses, le temps de la session
const once = (key, loader) => {
  if (!details.has(key)) details.set(key, loader().catch((e) => { details.delete(key); throw e; }));
  return details.get(key);
};

let modal;
let onAuthError = () => {};
let getTrack = () => null; // titre tel qu'affiché dans la liste (pour time_add)
let openSeq = 0;

const RECORD_TYPES = { album: 'Album', single: 'Single', ep: 'EP', compile: 'Compilation' };
const ROLES = { Main: 'Artiste principal', Featured: 'Invité' };
const EXPLICIT = {
  0: 'Non', 1: 'Oui', 2: 'Inconnu', 3: 'Version censurée',
  4: 'En partie', 5: 'En partie (inconnu)', 6: 'Non renseigné', 7: 'En partie (non renseigné)',
};

export function initTrackDetail({ authError, lookup }) {
  onAuthError = authError;
  getTrack = lookup;
  const el = $('#track-modal');
  modal = bootstrap.Modal.getOrCreateInstance(el);
  el.addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    if (play) {
      const t = getTrack(play.dataset.play) || el._track;
      if (t) player.toggle(t);
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy)
        .then(() => toast(`${copy.dataset.copyLabel || 'Valeur'} copié.`, 'success'))
        .catch(() => toast('Copie impossible dans ce navigateur.', 'danger'));
    }
  });
  el.addEventListener('hidden.bs.modal', () => { $('#track-modal-body').innerHTML = ''; el._track = null; });
}

export async function openTrack(id) {
  const my = ++openSeq;
  const el = $('#track-modal');
  const listed = getTrack(id);
  $('#track-modal-title').textContent = listed?.title || 'Titre';
  $('#track-modal-body').innerHTML = loadingHTML('Chargement de la fiche…');
  modal.show();

  try {
    const track = await once(`track:${id}`, () => api(`/track/${id}`));
    if (my !== openSeq) return;
    const album = track.album?.id
      ? await once(`album:${track.album.id}`, () => api(`/album/${track.album.id}`)).catch(() => null)
      : null;
    if (my !== openSeq) return;

    // L'extrait de /track est plus récent que celui de la liste
    if (listed && track.preview) listed.preview = track.preview;
    el._track = listed || track;
    $('#track-modal-title').textContent = track.title_short || track.title;
    $('#track-modal-body').innerHTML = renderDetail(track, album, listed);
    player.sync();
  } catch (e) {
    if (my !== openSeq) return;
    if (e instanceof AuthError) { modal.hide(); onAuthError(e); return; }
    $('#track-modal-body').innerHTML = `<div class="alert alert-danger m-0">${esc(e.message)}</div>`;
  }
}

function row(label, value, icon) {
  if (value == null || value === '') return '';
  return `<div class="td-fact"><dt><i class="bi ${icon}"></i>${esc(label)}</dt><dd>${value}</dd></div>`;
}

function copyBtn(value, label) {
  return `<button type="button" class="td-copy" data-copy="${esc(value)}" data-copy-label="${esc(label)}"
    title="Copier" aria-label="Copier ${esc(label)}"><i class="bi bi-copy"></i></button>`;
}

function renderDetail(t, album, listed) {
  const cover = album?.cover_xl || t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium;
  const contributors = (t.contributors?.length ? t.contributors : [t.artist]).filter(Boolean);
  const genres = album?.genres?.data?.map((g) => g.name).filter(Boolean) || [];
  const countries = Array.isArray(t.available_countries) ? t.available_countries : null;
  const release = t.release_date || album?.release_date || t.album?.release_date;
  const position = t.track_position
    ? `Piste ${t.track_position}${album?.nb_tracks ? ` / ${album.nb_tracks}` : ''}${t.disk_number > 1 || album?.nb_disk > 1 ? ` · disque ${t.disk_number}` : ''}`
    : '';
  const bpm = Number(t.bpm) > 0
    ? `${Number(t.bpm).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} <span class="td-muted">(estimé par Deezer)</span>`
    : '<span class="td-muted">non renseigné</span>';
  const rank = Number(t.rank) || 0;
  const explicit = EXPLICIT[t.explicit_content_lyrics] ?? (t.explicit_lyrics ? 'Oui' : 'Non');

  const unavailable = t.readable === false
    ? `<div class="alert alert-warning small d-flex gap-2 align-items-start">
        <i class="bi bi-exclamation-triangle"></i><div>Ce titre n’est plus disponible à l’écoute sur Deezer.
        ${t.alternative?.id ? `<a href="${esc(t.alternative.link || `https://www.deezer.com/track/${t.alternative.id}`)}" target="_blank" rel="noopener">Voir la version de remplacement</a>` : ''}</div></div>`
    : '';

  return `
    <div class="td-head">
      <img class="td-cover" src="${esc(cover)}" alt="">
      <div class="td-head-body">
        <div class="td-kicker">${esc(RECORD_TYPES[album?.record_type] || 'Titre')}${t.explicit_lyrics ? ' · <span class="badge-explicit" title="Contenu explicite">E</span>' : ''}</div>
        <h3 class="td-title">${esc(t.title_short || t.title)}${t.title_version ? ` <span class="td-version">${esc(t.title_version)}</span>` : ''}</h3>
        <div class="td-artists">${contributors.map((c) => `<a href="${esc(c.link || `https://www.deezer.com/artist/${c.id}`)}" target="_blank" rel="noopener">${esc(c.name)}</a>`).join(', ')}</div>
        <div class="td-album">
          <i class="bi bi-disc"></i>
          ${t.album?.link || album?.link ? `<a href="${esc(album?.link || t.album.link)}" target="_blank" rel="noopener">${esc(t.album?.title || album?.title)}</a>` : esc(t.album?.title)}
          ${release ? ` · ${esc(String(release).slice(0, 4))}` : ''}
        </div>
        <div class="td-actions">
          <button type="button" class="btn btn-primary play-wide" data-play="${t.id}" ${t.preview ? '' : 'disabled'}>
            <i class="play-icon bi bi-play-fill"></i><span class="play-label">${t.preview ? 'Écouter l’extrait' : 'Pas d’extrait'}</span>
          </button>
          <a class="btn btn-outline-secondary" href="${esc(t.link || `https://www.deezer.com/track/${t.id}`)}" target="_blank" rel="noopener">
            <i class="bi bi-box-arrow-up-right me-1"></i>Ouvrir dans Deezer</a>
        </div>
      </div>
    </div>

    ${unavailable}

    <h4 class="td-section">Informations</h4>
    <dl class="td-facts">
      ${row('Durée', fmtDuration(t.duration), 'bi-clock')}
      ${row('Date de sortie', release ? fmtDate(release, { day: 'numeric', month: 'long', year: 'numeric' }) : '', 'bi-calendar3')}
      ${row('Position', esc(position), 'bi-list-ol')}
      ${row('Ajouté aux coups de cœur', listed?.time_add ? fmtDate(listed.time_add, { day: 'numeric', month: 'long', year: 'numeric' }) : '', 'bi-heart')}
      ${row('Label', esc(album?.label), 'bi-building')}
      ${row('Genres', genres.length ? genres.map((g) => `<span class="td-chip">${esc(g)}</span>`).join(' ') : '', 'bi-tags')}
      ${row('Contenu explicite', esc(explicit), 'bi-exclamation-octagon')}
      ${row('Popularité', `${fmtNumber(rank)}<div class="td-bar"><span style="width:${Math.min(100, rank / 10000).toFixed(1)}%"></span></div>`, 'bi-graph-up')}
    </dl>

    <h4 class="td-section">Données techniques</h4>
    <dl class="td-facts">
      ${row('ISRC', t.isrc ? `<code>${esc(t.isrc)}</code>${copyBtn(t.isrc, 'ISRC')}` : '<span class="td-muted">non renseigné</span>', 'bi-upc')}
      ${row('UPC de l’album', album?.upc ? `<code>${esc(album.upc)}</code>${copyBtn(album.upc, 'UPC')}` : '', 'bi-upc-scan')}
      ${row('Identifiant Deezer', `<code>${esc(t.id)}</code>${copyBtn(String(t.id), 'Identifiant')}`, 'bi-hash')}
      ${row('BPM', bpm, 'bi-speedometer2')}
      ${row('Gain (normalisation)', t.gain != null && t.gain !== 0 ? `${String(t.gain).replace('.', ',').replace('-', '−')} dB` : '', 'bi-volume-up')}
      ${row('Disponibilité', countries ? `${countries.includes('FR') ? '<span class="td-ok"><i class="bi bi-check-circle-fill"></i> France</span> · ' : '<span class="td-ko"><i class="bi bi-x-circle-fill"></i> Pas en France</span> · '}${fmtNumber(countries.length)} pays` : '', 'bi-globe2')}
    </dl>

    ${contributors.length > 1 || contributors[0]?.role ? `
      <h4 class="td-section">Artistes</h4>
      <ul class="td-people">
        ${contributors.map((c) => `<li>
          <img src="${esc(c.picture_small || c.picture_medium || '')}" alt="" loading="lazy">
          <div><a href="${esc(c.link || `https://www.deezer.com/artist/${c.id}`)}" target="_blank" rel="noopener">${esc(c.name)}</a>
          <div class="td-muted small">${esc(ROLES[c.role] || c.role || 'Artiste')}</div></div></li>`).join('')}
      </ul>` : ''}

    <details class="td-raw">
      <summary>Données brutes de l’API (JSON)</summary>
      <pre><code>${esc(JSON.stringify({ ...t, available_countries: countries ? `[${countries.length} pays]` : undefined }, null, 2))}</code></pre>
    </details>`;
}
