// Accès à l'API Deezer depuis le navigateur.
// api.deezer.com n'envoie pas d'en-têtes CORS : les appels passent en JSONP
// (paramètres output=jsonp&callback=...), comme le fait le SDK JavaScript officiel.

import { CONFIG } from './config.js';

const API_BASE = 'https://api.deezer.com';
const AUTH_URL = 'https://connect.deezer.com/oauth/auth.php';
const TOKEN_KEY = 'mydeezer.token';

export class AuthError extends Error {}

/* ---------- Authentification (OAuth implicite) ---------- */

export const auth = {
  get() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
      if (!t?.token) return null;
      if (t.expiresAt && Date.now() > t.expiresAt) { this.clear(); return null; }
      return t.token;
    } catch { return null; }
  },

  save(token, expires) {
    const s = Number(expires) || 0; // 0 = pas d'expiration (offline_access)
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      token, expiresAt: s > 0 ? Date.now() + s * 1000 : null,
    }));
  },

  clear() { localStorage.removeItem(TOKEN_KEY); },

  redirectUri() { return CONFIG.REDIRECT_URI || location.origin + location.pathname; },

  login() {
    const p = new URLSearchParams({
      app_id: CONFIG.APP_ID,
      redirect_uri: this.redirectUri(),
      perms: CONFIG.PERMS.join(','),
      response_type: 'token',
    });
    location.assign(`${AUTH_URL}?${p}`);
  },

  // Au retour de Deezer : #access_token=...&expires=... ou ?error_reason=...
  consumeRedirect() {
    const hash = location.hash.replace(/^#/, '');
    if (hash.includes('access_token=')) {
      const p = new URLSearchParams(hash);
      this.save(p.get('access_token'), p.get('expires'));
      history.replaceState(null, '', location.pathname + '#/playlists');
      return { ok: true };
    }
    const q = new URLSearchParams(location.search);
    const err = q.get('error_reason') || q.get('error');
    if (err) {
      history.replaceState(null, '', location.pathname);
      return { error: err };
    }
    return null;
  },
};

/* ---------- JSONP ---------- */

let seq = 0;
function jsonp(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const cb = `__dz_${Date.now().toString(36)}_${++seq}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(true); reject(new Error('Deezer ne répond pas (délai dépassé).')); }, timeout);

    function cleanup(late) {
      clearTimeout(timer);
      script.remove();
      // Une réponse tardive ne doit pas lever d'erreur
      if (late) window[cb] = () => delete window[cb]; else delete window[cb];
    }

    window[cb] = (data) => { cleanup(false); resolve(data); };
    script.onerror = () => {
      cleanup(false);
      reject(new Error(navigator.onLine ? 'Impossible de joindre l’API Deezer.' : 'Vous êtes hors ligne.'));
    };

    const u = new URL(url);
    u.searchParams.set('output', 'jsonp');
    u.searchParams.set('callback', cb);
    script.src = u.toString();
    script.referrerPolicy = 'no-referrer';
    document.head.appendChild(script);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- API ---------- */

export async function api(path, params = {}, { retries = 5 } = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const token = auth.get();
  if (token) url.searchParams.set('access_token', token);

  for (let attempt = 0; ; attempt++) {
    const data = await jsonp(url.toString());
    if (data && data.error) {
      const { code, type, message } = data.error;
      // Quota dépassé (50 requêtes / 5 s) : on patiente puis on réessaie
      if (code === 4 && attempt < retries) { await sleep(1200 * (attempt + 1)); continue; }
      if (code === 300 || (type === 'OAuthException' && /token/i.test(message || ''))) {
        throw new AuthError('Votre session Deezer a expiré. Reconnectez-vous.');
      }
      throw new Error(`Deezer : ${message || type || 'erreur'}${code != null ? ` (code ${code})` : ''}`);
    }
    return data;
  }
}

// Charge une liste complète en suivant la pagination de l'API
export async function fetchAll(path, { params = {}, onProgress } = {}) {
  const items = [];
  let index = 0;
  let total = null;
  for (let guard = 0; guard < 500; guard++) {
    const data = await api(path, { ...params, index, limit: CONFIG.FETCH_LIMIT });
    const batch = Array.isArray(data?.data) ? data.data : [];
    if (typeof data?.total === 'number') total = data.total;
    items.push(...batch);
    index += batch.length;
    onProgress?.(items.length, total);
    if (!data?.next || batch.length === 0) break;
  }
  return { items, total: total ?? items.length };
}
