# Migration des 4 apps vers turbo-app

Objectif : regrouper les apps existantes sous le hub, sans réécrire leur code.
Chaque app conserve tous ses fichiers ; on retire seulement ce qui doit devenir
unique au niveau du hub (service worker + manifest + icône installable).

## Convention de nommage (slug)

| App source        | slug          | dossier cible            |
|-------------------|---------------|--------------------------|
| CARHYCE           | `carhyce`     | `apps/carhyce/`          |
| Jaugeage          | `jaugeage`    | `apps/jaugeage/`         |
| Checklist/Matériel| `checklist`   | `apps/checklist/`        |
| meteo_hydro       | `meteo-hydro` | `apps/meteo-hydro/`      |

## Pour CHAQUE app (carhyce, jaugeage, checklist, meteo-hydro)

1. **Copier** l'intégralité du dossier de l'app dans `apps/<slug>/`
   (le `index.html` de l'app doit se trouver directement dans `apps/<slug>/index.html`).

2. **Supprimer** le service worker propre à l'app :
   `sw.js` (ou tout fichier `service-worker.js` équivalent).

3. **Supprimer** le manifest propre à l'app :
   `manifest.json` **et/ou** `manifest.webmanifest`.

4. Dans le `index.html` de l'app, **supprimer la ligne** du manifest :
   `<link rel="manifest" href="...">`
   (le manifest racine gouverne désormais l'installation).
   → Conserver `theme-color`, les `<link rel="icon">` et l'`apple-touch-icon` :
   ils restent valides dans le sous-dossier.

5. *(Optionnel mais propre)* Supprimer le bloc d'enregistrement du SW dans le
   code de l'app (`navigator.serviceWorker.register('./sw.js')`). S'il reste,
   il échoue silencieusement (404) sans casser l'app — le SW racine prend le
   relais. À retirer dès que possible pour éviter toute confusion.

6. **Vérifier les chemins** : tous les liens internes de l'app doivent être
   **relatifs** (`./fichier.js`, `fichier.css`) et jamais absolus (`/fichier.js`).
   Un chemin absolu casserait dans le sous-dossier. Les 4 apps utilisent déjà
   des chemins relatifs — vérifier seulement en cas de doute.

## Spécifique meteo-hydro

7. Placer ses fichiers de données **dans** `apps/meteo-hydro/` :
   `stations_debits.csv`, `communes.csv` (l'app les charge en `./`).
   Aucune action offline : cette app reste en ligne (déclarée `offline:false`).

## Au niveau racine (une seule fois)

8. Déposer les fichiers du shell fournis (index.html, apps.js, manifest.json,
   sw.js, build_sw_assets.py, icon.*, shared/, .nojekyll) à la racine du dépôt.

9. Régénérer la liste de précache :
   ```
   python build_sw_assets.py
   ```
   Le script doit lister `carhyce, jaugeage, checklist` en « précachées » et
   `meteo-hydro` en « exclue », sans avertissement de dossier manquant.

10. **Pousser** sur `main`, activer Pages sur `/ (root)`.

## Vérifications post-déploiement

- Ouvrir le hub en ligne une première fois (laisse le SW précacher).
- Couper le réseau : carhyce, jaugeage, checklist doivent s'ouvrir et
  fonctionner ; meteo-hydro doit indiquer l'absence de données temps réel.
- « Ajouter à l'écran d'accueil » : une seule icône « Turbo » installe le tout.
- À chaque mise à jour ultérieure : relancer `build_sw_assets.py` avant de
  pousser (la version de cache est horodatée → bascule automatique).
