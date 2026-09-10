// geo.js — conversions de coordonnées pour CARHYCE Saisie Terrain
// WGS84 (lat/lon décimaux) -> RGF93 / Lambert 93 (EPSG:2154), en mètres.
//
// Implémentation directe de la projection conique conforme de Lambert (IGN,
// ellipsoïde GRS80). L'écart RGF93 <-> WGS84 étant infra-métrique, aucune
// transformation de datum n'est appliquée : suffisant pour une carto de station
// et pour reporter des coordonnées GPS terrain. Aucune dépendance externe
// (pas de proj4) : fonctionne hors-ligne sans rien charger.

const GEO = {
  _deg2rad(d) { return d * Math.PI / 180; },

  // Parse robuste : null / undefined / chaîne vide -> NaN (et non 0),
  // accepte la virgule décimale.
  _num(v) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).replace(',', '.').trim();
    if (s === '' || s === '-' || s === '.') return NaN;
    return Number(s);
  },

  // Renvoie { x, y } en mètres (L93) ou null si entrée invalide.
  wgs84ToL93(latDeg, lonDeg) {
    const lat = this._num(latDeg);
    const lon = this._num(lonDeg);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    // Garde-fou : coordonnées géographiques plausibles uniquement.
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    const a  = 6378137.0;                 // demi-grand axe GRS80 (non utilisé direct mais documenté)
    const e  = 0.0818191910428158;        // 1re excentricité GRS80
    const n  = 0.725607765053267;         // exposant de projection L93
    const C  = 11754255.426096;           // constante de projection L93
    const Xs = 700000.0;                  // easting du pôle
    const Ys = 12655612.049876;           // northing du pôle
    const lc = this._deg2rad(3);          // méridien central : 3° Est

    const phi    = this._deg2rad(lat);
    const lambda = this._deg2rad(lon);

    const es = e * Math.sin(phi);
    // Latitude isométrique
    const latIso = Math.log(
      Math.tan(Math.PI / 4 + phi / 2) *
      Math.pow((1 - es) / (1 + es), e / 2)
    );

    const R = C * Math.exp(-n * latIso);
    const gamma = n * (lambda - lc);

    const X = Xs + R * Math.sin(gamma);
    const Y = Ys - R * Math.cos(gamma);

    return { x: Math.round(X * 100) / 100, y: Math.round(Y * 100) / 100 };
  },
};

// Exposition globale (l'app n'utilise pas de modules ES).
window.GEO = GEO;
