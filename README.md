# myDeezer

Application monopage (JavaScript + Bootstrap 5.3), installable en PWA, **sans aucune partie serveur**.
Elle permet de consulter son compte Deezer : playlists (cartels illustrés), coups de cœur
(extraits audio, export JSON/CSV) et profil. Toutes les listes proposent une recherche
et une pagination (25 par défaut, ou 5, 10, 100, 200, 500, 1000, 2000).

## 1. Configurer l'application chez Deezer

Sur <https://developers.deezer.com/myapps>, ouvrez l'application **myPlaylists2** (ID `376204`) :

- **Application domain** : le domaine où l'appli sera hébergée (ex. `test.gpmfactory.com`) ;
- **Redirect URL after authentication** : l'URL exacte de la page, avec la barre finale
  (ex. `https://test.gpmfactory.com/mydeezer/`).

L'URL de retour est l'adresse de la page elle-même (par défaut `location.origin + location.pathname`).

> La **clé secrète n'est pas utilisée**. Sans serveur, l'appli emploie le flux OAuth
> « client-side » (`response_type=token`) prévu par Deezer pour ce cas. Ne mettez jamais
> la clé secrète dans le code : tout fichier JavaScript est lisible par n'importe qui.

Si l'URL de retour doit être différente de l'adresse de la page, renseignez
`REDIRECT_URI` dans `js/config.js`.

## 2. Héberger

Copiez le dossier tel quel sur n'importe quel hébergement statique en **HTTPS**
(OVH, GitHub Pages, Netlify…). HTTPS est obligatoire pour la PWA, sauf sur `localhost`.

Test local :

```bash
cd mydeezer
python3 -m http.server 8080
# http://localhost:8080/  (déclarer cette URL comme redirect chez Deezer)
```

## Fonctionnement technique

| Point | Choix |
|---|---|
| Authentification | OAuth implicite Deezer, permissions `basic_access`, `email`, `offline_access` (jeton sans expiration, stocké dans `localStorage`) |
| Appels API | **JSONP** (`output=jsonp`) car `api.deezer.com` n'envoie pas d'en-têtes CORS |
| Chargement | Listes chargées en entier par lots de 1000 (`index`/`limit`), puis pagination et recherche côté navigateur |
| Quota | Erreur Deezer code 4 (50 requêtes / 5 s) : nouvel essai automatique |
| Session expirée | Code 300 : retour à l'écran de connexion |
| Extraits | URL `preview` (30 s). Si l'URL signée a expiré, l'appli en redemande une fraîche via `/track/{id}` |
| Export | JSON ou CSV (séparateur `;` + BOM UTF-8, s'ouvre directement dans Excel FR). Exporte la liste complète ou le résultat de la recherche en cours |
| PWA | `manifest.webmanifest` + `sw.js` (cache de l'application, pas des données Deezer) |
| Dépendances | Bootstrap 5.3.8 et Bootstrap Icons embarqués dans `vendor/` (aucun CDN) |

Raccourci clavier : `/` place le curseur dans la recherche, `Échap` l'efface.

## Fichiers

```
index.html              structure, menu à gauche, lecteur
css/app.css             thème clair/sombre
js/config.js            APP_ID, permissions, tailles de page
js/deezer.js            OAuth + API JSONP + chargement complet paginé
js/ui.js                composant liste (recherche, pagination), utilitaires
js/player.js            lecteur d'extraits
js/app.js               routeur et vues (playlists, coups de cœur, profil)
sw.js                   service worker
manifest.webmanifest    manifeste PWA
icons/                  icônes (SVG, 192, 512, maskable)
vendor/                 Bootstrap + Bootstrap Icons
```

Après une mise à jour des fichiers, incrémentez `CACHE` dans `sw.js` (`mydeezer-v2`…)
pour que les navigateurs récupèrent la nouvelle version.

## Partage sur LinkedIn

`index.html` contient les balises Open Graph (titre, description, image `icons/og-image.jpg`
en 2400×1254, JPEG qualité 90 sans sous-échantillonnage des couleurs). LinkedIn exige des **URL absolues** : elles pointent vers
`https://mydeezer.gpmfactory.com/`. Si l'appli est publiée ailleurs, remplacez ce domaine
dans les balises `og:*`, `twitter:*` et `canonical`.

LinkedIn garde l'aperçu en cache : après une modification, forcez la relecture avec le
[Post Inspector](https://www.linkedin.com/post-inspector/).

