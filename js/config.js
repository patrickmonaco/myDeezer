// Configuration de myDeezer
// Seul l'identifiant d'application est nécessaire : l'authentification utilise le
// flux OAuth "client-side" de Deezer (response_type=token), sans clé secrète.
// Ne mettez JAMAIS la clé secrète dans ce fichier : il est téléchargé par le navigateur.

export const CONFIG = {
  APP_ID: '376204',            // Application myPlaylists2

  // Affiché dans « À propos ». Pensez à incrémenter aussi CACHE dans sw.js.
  VERSION: '1.8.0',
  CREATED: '2026-10-27',
  UPDATED: '2026-10-28',

  // URL de retour après connexion. Elle doit correspondre au domaine / à l'URL
  // déclarés dans la configuration de l'application sur developers.deezer.com.
  // null = URL courante de l'application (ex. https://mon-site.fr/mydeezer/)
  REDIRECT_URI: null,

  // basic_access : profil et bibliothèque · email : adresse e-mail du profil
  // offline_access : jeton sans expiration (sinon ~1 h)
  PERMS: ['basic_access', 'email', 'offline_access'],

  PAGE_SIZES: [5, 10, 25, 100, 200, 500, 1000, 2000],
  DEFAULT_PAGE_SIZE: 25,

  // Taille des lots demandés à l'API pour charger une liste complète
  FETCH_LIMIT: 1000,
};
