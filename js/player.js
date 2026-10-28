// Lecteur d'extraits (30 s) fourni par l'API Deezer

import { api, AuthError } from './deezer.js';
import { $, $$, esc, toast, fmtDuration } from './ui.js';

const audio = new Audio();
audio.preload = 'none';
let current = null;
let retried = false;

const bar = () => $('#player');

let toggleSeq = 0;

// Certaines listes (notamment /user/me/tracks) renvoient un champ preview vide :
// on demande alors l'extrait au détail du titre, une seule fois par titre.
async function resolvePreview(track) {
  if (track.preview || track.noPreview) return;
  setLoading(track.id, true);
  try {
    const fresh = await api(`/track/${track.id}`);
    if (fresh?.preview) track.preview = fresh.preview;
    else track.noPreview = true;
  } catch (e) {
    toast(e instanceof AuthError ? e.message : 'Impossible de récupérer l’extrait.', 'danger');
    return;
  } finally {
    setLoading(track.id, false);
  }
}

function setLoading(id, on) {
  $$(`[data-play="${id}"]`).forEach((b) => {
    b.classList.toggle('is-loading', on);
    const i = b.querySelector('.play-icon');
    if (i && on) i.className = 'play-icon bi bi-arrow-repeat spin';
  });
  if (!on) sync();
}

function markUnavailable(id) {
  $$(`[data-play="${id}"]`).forEach((b) => {
    b.disabled = true;
    b.title = 'Pas d’extrait disponible';
    const label = b.querySelector('.play-label');
    if (label) label.textContent = 'Pas d’extrait';
  });
}

export async function toggle(track) {
  if (current && current.id === track.id) {
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    return;
  }
  const my = ++toggleSeq;
  if (!track.preview) await resolvePreview(track);
  if (my !== toggleSeq) return; // un autre titre a été demandé entre-temps
  if (!track.preview) {
    if (track.noPreview) { markUnavailable(track.id); toast('Aucun extrait disponible pour ce titre.'); }
    return;
  }
  current = track;
  retried = false;
  audio.src = track.preview;
  audio.play().catch(() => {});
  show();
  sync();
}

export function stop() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  current = null;
  bar().classList.add('d-none');
  document.body.classList.remove('has-player');
  sync();
}

// Met à jour les boutons lecture visibles dans les listes
export function sync() {
  const playing = current && !audio.paused;
  $$('[data-play]').forEach((b) => {
    const on = playing && b.dataset.play === String(current.id);
    b.classList.toggle('is-playing', on);
    b.classList.toggle('is-current', !!current && b.dataset.play === String(current.id));
    const i = b.querySelector('.play-icon');
    if (i) i.className = `play-icon bi ${on ? 'bi-pause-fill' : 'bi-play-fill'}`;
    b.setAttribute('aria-label', on ? 'Mettre en pause' : 'Écouter l’extrait');
    const label = b.querySelector('.play-label');
    if (label && !b.disabled) label.textContent = on ? 'Pause' : 'Écouter l’extrait';
  });
  const pb = $('#player-toggle i');
  if (pb) pb.className = `bi ${playing ? 'bi-pause-fill' : 'bi-play-fill'}`;
}

function show() {
  const t = current;
  const el = bar();
  $('#player-cover').src = t.album?.cover_small || '';
  $('#player-title').innerHTML = esc(t.title);
  $('#player-artist').innerHTML = esc([t.artist?.name, t.album?.title].filter(Boolean).join(' · '));
  $('#player-link').href = t.link || '#';
  $('#player-progress-fill').style.width = '0%';
  $('#player-time').textContent = '0:00';
  el.classList.remove('d-none');
  document.body.classList.add('has-player');

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist?.name || '',
      album: t.album?.title || '',
      artwork: t.album?.cover_big ? [{ src: t.album.cover_big, sizes: '500x500', type: 'image/jpeg' }] : [],
    });
  }
}

audio.addEventListener('play', sync);
audio.addEventListener('pause', sync);
audio.addEventListener('ended', () => { audio.currentTime = 0; sync(); });
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 30;
  $('#player-progress-fill').style.width = `${Math.min(100, (audio.currentTime / d) * 100)}%`;
  $('#player-time').textContent = `${fmtDuration(audio.currentTime)} / ${fmtDuration(d)}`;
});

// Les URL d'extrait sont signées et expirent : on en redemande une fraîche une fois
audio.addEventListener('error', async () => {
  if (!current || !audio.getAttribute('src')) return;
  if (retried) { toast('Extrait indisponible pour ce titre.', 'danger'); sync(); return; }
  retried = true;
  const t = current;
  try {
    const fresh = await api(`/track/${t.id}`);
    if (current !== t) return;
    if (!fresh.preview) throw new Error();
    t.preview = fresh.preview;
    audio.src = fresh.preview;
    audio.play().catch(() => {});
  } catch {
    if (current === t) { toast('Extrait indisponible pour ce titre.', 'danger'); sync(); }
  }
});

export function initPlayer() {
  $('#player-toggle').addEventListener('click', () => current && toggle(current));
  $('#player-close').addEventListener('click', stop);
  $('#player-progress').addEventListener('click', (e) => {
    if (!current || !audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  }
}
