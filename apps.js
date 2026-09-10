/* ============================================================
   REGISTRE CENTRAL — source unique de vérité
   ------------------------------------------------------------
   Lu par le launcher (index.html) ET par le service worker (sw.js).
   Attaché à `self` pour être compatible fenêtre + worker.

   Pour ajouter une app :
     1. déposer son dossier dans  apps/<slug>/
     2. ajouter une ligne ci-dessous
     3. relancer  python build_sw_assets.py

   offline:true  -> précachée, disponible 100 % hors connexion
   offline:false -> non précachée, réseau requis (données temps réel)

   icone : chemin vers l'icône réelle de l'app (affichée sur le launcher).
           Peut être un fichier (./apps/<slug>/...) ou un data-URI.
           Un simple emoji reste accepté en repli.
   ============================================================ */
self.APPS = [
  {
    slug:    "carhyce",
    nom:     "CARHYCE",
    desc:    "Saisie hydromorphologie",
    accent:  "#1e4f7a",
    icone:   "./apps/carhyce/icon.svg",
    offline: true
  },
  {
    slug:    "jaugeage",
    nom:     "Jaugeage",
    desc:    "Calcul de débit",
    accent:  "#56c2b1",
    icone:   "./apps/jaugeage/icon-192.svg",
    offline: true
  },
  {
    slug:    "checklist",
    nom:     "Matériel Terrain",
    desc:    "Checklist de préparation",
    accent:  "#62b857",
    icone:   "./apps/checklist/icon-512.png",
    offline: true
  },
  {
    slug:    "meteo-hydro",
    nom:     "Hydro-Météo",
    desc:    "Bilan temps réel",
    accent:  "#00b4d8",
    icone:   "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%2300b4d8'/%3E%3Cstop offset='1' stop-color='%230077b6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='512' height='512' rx='96' fill='url(%23g)'/%3E%3Cpath d='M256 104 C200 194 160 252 160 314 a96 96 0 1 0 192 0 C352 252 312 194 256 104 Z' fill='%23ffffff'/%3E%3C/svg%3E",
    offline: false
  }
];
