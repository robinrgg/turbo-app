# Turbo App — hub des outils terrain Aquascop

Coquille (shell) unique regroupant plusieurs applications web autonomes sous une
seule URL, une seule icône installable et un seul service worker. Chaque app
reste indépendante dans son dossier ; le hub ne fait que les lister, les lancer
et gérer le cache hors-ligne de façon centralisée.

Aucune dépendance npm, aucun build JavaScript. Un seul script Python (stdlib)
pour régénérer la liste de précache.

## Arborescence

```
turbo-app/
├── index.html            # launcher : grille de cartes générée depuis apps.js
├── apps.js               # REGISTRE central (source unique de vérité)
├── manifest.json         # PWA racine — une seule icône installable
├── sw.js                 # service worker racine (offline/online unifié)
├── precache-manifest.js  # GÉNÉRÉ — liste de précache (ne pas éditer)
├── build_sw_assets.py    # régénère precache-manifest.js
├── icon.svg              # icône du hub
├── icon-192.png
├── icon-512.png
├── .nojekyll             # évite tout traitement Jekyll sur GitHub Pages
├── shared/
│   └── tokens.css        # design tokens communs (adoption optionnelle)
└── apps/
    ├── carhyce/          # apps déplacées ici, inchangées (voir MIGRATION)
    ├── jaugeage/
    ├── checklist/
    └── meteo-hydro/
```

## Ajouter une nouvelle app

1. Déposer le dossier de l'app dans `apps/<slug>/` (un `index.html` à sa racine).
2. Ajouter une entrée dans `apps.js` (le `slug` doit être identique au dossier).
3. Lancer `python build_sw_assets.py`.
4. Pousser sur GitHub.

`offline: true` → l'app est précachée et fonctionne sans réseau.
`offline: false` → l'app n'est pas précachée (réseau requis, données temps réel).

## Service worker — stratégies

| Type de requête                                   | Stratégie      |
|---------------------------------------------------|----------------|
| Hub'Eau, geo.api.gouv.fr (données vivantes)       | réseau seul    |
| CDN figés (SheetJS, polices, Leaflet, Chart.js)   | cache-first    |
| Même origine (shell + apps)                       | network-first  |

La version de cache (`PRECACHE_VERSION`) est horodatée à chaque exécution du
script : un nouveau déploiement invalide automatiquement l'ancien cache.

## Dépendances CDN hors-ligne

Le scan de dossier ne détecte pas les URL externes. Toute dépendance CDN
indispensable au fonctionnement hors-ligne doit être ajoutée à la liste `CDN`
en tête de `build_sw_assets.py`. Actuellement : SheetJS (export Excel CARHYCE).

## Déploiement (GitHub Pages)

1. Pousser le contenu de ce dossier à la racine du dépôt.
2. Settings → Pages → branche `main`, dossier `/ (root)`.
3. URL : `https://<utilisateur>.github.io/<dépôt>/`.
4. Première ouverture en ligne : le SW met tout en cache. Ensuite, les apps
   `offline:true` fonctionnent sans réseau. « Ajouter à l'écran d'accueil »
   installe le hub complet sous une seule icône.
