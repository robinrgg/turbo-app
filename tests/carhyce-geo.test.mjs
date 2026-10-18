// Projection Lambert 93 vérifiée par ses propriétés de définition (IGN), sans référence externe :
// origine (3° E, 46,5° N) → (700 000 ; 6 600 000), méridien central → X = 700 000,
// facteur d'échelle exactement 1 sur les parallèles standards 44° et 49°, conformité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFile } from './helpers.mjs';

const { GEO } = loadFile('apps/carhyce/geo.js', ['GEO'], { window: {} });
const L = (lat, lon) => GEO.wgs84ToL93(lat, lon);

test('origine du Lambert 93 : 46,5° N / 3° E → (700 000 ; 6 600 000)', () => {
  const p = L(46.5, 3);
  assert.ok(Math.abs(p.x - 700000) < 0.02 && Math.abs(p.y - 6600000) < 0.02, JSON.stringify(p));
});

test('méridien central : X = 700 000 m quelle que soit la latitude', () => {
  for (const lat of [42, 44, 46, 48, 51]) assert.equal(L(lat, 3).x, 700000);
});

test('symétrie autour du méridien central', () => {
  const a = L(45, 1), b = L(45, 5);
  assert.ok(Math.abs((a.x - 700000) + (b.x - 700000)) < 0.02);
  assert.ok(Math.abs(a.y - b.y) < 0.02);
});

// Distance projetée / distance sur l'ellipsoïde pour un petit pas le long du méridien
function echelle(lat) {
  const a = 6378137, e2 = 0.00669438002290, phi = lat * Math.PI / 180, dLat = 1e-4;
  const M = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi) ** 2, 1.5);   // rayon de courbure méridien
  const dy = L(lat + dLat / 2, 3).y - L(lat - dLat / 2, 3).y;
  return dy / (M * dLat * Math.PI / 180);
}

test('facteur d’échelle = 1 sur les parallèles standards 44° et 49°, < 1 entre les deux', () => {
  // arrondi au cm des sorties sur ~11 m de pas → précision ≈ 1e-3
  assert.ok(Math.abs(echelle(44) - 1) < 2e-3, echelle(44));
  assert.ok(Math.abs(echelle(49) - 1) < 2e-3, echelle(49));
  assert.ok(echelle(46.5) < 0.9995);
});

test('entrées invalides ou hors domaine → null ; virgule acceptée', () => {
  for (const [a, b] of [[null, 3], ['', 3], [91, 3], [45, 181], ['abc', 2]]) assert.equal(L(a, b), null);
  assert.deepEqual(JSON.parse(JSON.stringify(L('46,5', '3'))), JSON.parse(JSON.stringify(L(46.5, 3))));
});

test('ordre de grandeur plausible sur toute la France métropolitaine', () => {
  for (const [lat, lon] of [[51.09, 2.54], [42.33, 9.53], [48.45, -4.78], [43.92, 6.08]]) {
    const p = L(lat, lon);
    assert.ok(p.x > 50000 && p.x < 1250000 && p.y > 6000000 && p.y < 7150000, JSON.stringify(p));
  }
});
