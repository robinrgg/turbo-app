// Fichier officiel des débits caractéristiques (stations_debits.csv) : lecture par l'app
// comparée à une lecture CSV indépendante, puis cohérence physique des valeurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineScripts, loadFunctions, read } from './helpers.mjs';

const src = inlineScripts('apps/meteo-hydro/index.html');
const { parseCSV } = loadFunctions(src, ['splitCSVLine', 'parseCSV']);
const text = read('apps/meteo-hydro/stations_debits.csv');
const data = JSON.parse(JSON.stringify(parseCSV(text)));

// Lecteur CSV de référence, écrit indépendamment (automate caractère par caractère)
function refParse(t) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [h, ...body] = rows;
  return body.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
const ref = refParse(text);
const n = v => (v === '' ? null : parseFloat(v));

test('CSV : toutes les stations sont lues, codes uniques', () => {
  assert.equal(Object.keys(data).length, ref.length);
  assert.equal(new Set(ref.map(r => r.code_station)).size, ref.length);
});

test('CSV : chaque valeur lue par l’app est identique à la lecture de référence (y compris noms avec virgules ou guillemets)', () => {
  const ecarts = [];
  for (const r of ref) {
    const d = data[r.code_station];
    const ok = d && d.libelle_station === r.libelle_station && d.module === n(r.module_m3s) && d.q25 === n(r.q25_m3s)
      && d.qmna5 === n(r.qmna5_m3s) && d.lat === n(r.latitude) && d.lon === n(r.longitude);
    if (!ok) ecarts.push(r.code_station);
  }
  assert.deepEqual(ecarts, []);
  assert.equal(data.Y622402001.module, 12.728);                     // « La Tinée à Massoins [Le Bancairon, usine] »
  assert.equal(data.Y553403001.libelle_station, 'La Siagne à Pégomas - Parc "Berges de Cabrol"');
});

test('CSV : cohérence physique — QMNA5 ≤ module, coordonnées en France métropolitaine', () => {
  for (const [code, d] of Object.entries(data)) {
    if (d.module != null && d.qmna5 != null) assert.ok(d.qmna5 <= d.module, `${code} QMNA5 > module`);
    assert.ok(d.lat > 41 && d.lat < 51.5 && d.lon > -5.5 && d.lon < 10, `${code} coordonnées`);
  }
});
