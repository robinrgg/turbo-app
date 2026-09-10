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
   ============================================================ */
self.APPS = [
  {
    slug:    "carhyce",
    nom:     "CARHYCE",
    desc:    "Saisie hydromorphologie",
    accent:  "#56c2b1",
    icone:   "🌊",
    offline: true
  },
  {
    slug:    "jaugeage",
    nom:     "Jaugeage",
    desc:    "Calcul de débit",
    accent:  "#4a9fd4",
    icone:   "💧",
    offline: true
  },
  {
    slug:    "checklist",
    nom:     "Matériel Terrain",
    desc:    "Checklist de préparation",
    accent:  "#62b857",
    icone:   "✓",
    offline: true
  },
  {
    slug:    "meteo-hydro",
    nom:     "Hydro-Météo",
    desc:    "Bilan temps réel",
    accent:  "#00b4d8",
    icone:   "⛅",
    offline: false
  }
];
