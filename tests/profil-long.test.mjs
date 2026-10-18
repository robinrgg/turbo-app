import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineScripts, loadFunctions, read } from './helpers.mjs';

const src = inlineScripts('apps/profil-long/index.html');
const ctx = loadFunctions(src,
  ['parseNum', 'todayISO', 'newTroncon', 'newStation', 'computeSynthese', 'buildExport', 'stationFromImport']);
const ref = JSON.parse(read('tests/fixtures/profil_long_reference.json'));
const plain = o => JSON.parse(JSON.stringify(o));

test('parseNum accepte virgule et point, rejette le vide', () => {
  assert.equal(ctx.parseNum('42,5'), 42.5);
  assert.equal(ctx.parseNum(' 7.25 '), 7.25);
  for (const v of ['', null, undefined, '-', '.', 'abc']) assert.equal(ctx.parseNum(v), null);
});

test('synthèse identique à celle exportée sur un relevé réel (34 tronçons)', () => {
  const st = ctx.stationFromImport(ref);
  const c = ctx.computeSynthese(st);
  assert.equal(c.nValid, 34);
  assert.equal(+c.dH.toFixed(4), ref.synthese.delta_h_m);
  assert.equal(+c.sDist.toFixed(3), ref.synthese.sigma_distance_m);
  assert.equal(+c.penteEstimee.toFixed(3), ref.synthese.pente_estimee_pourmille);
  assert.equal(+c.penteReg.toFixed(3), ref.synthese.pente_regression_pourmille);
});

test('pente : un fond régulier à 10 ‰ donne 10 ‰ par les deux méthodes', () => {
  const st = ctx.newStation();
  st.troncons = [0, 1, 2, 3].map(i => ({ ...plain(ctx.newTroncon()), distance_m: 10,
    aval: { fh: null, fm: 150, fb: null }, amont: { fh: null, fm: 140, fb: null } }));
  const c = ctx.computeSynthese(st);
  assert.ok(Math.abs(c.penteEstimee - 10) < 1e-9);
  assert.ok(Math.abs(c.penteReg - 10) < 1e-9);
});

test('les tronçons incomplets sont ignorés', () => {
  const st = ctx.newStation();
  st.troncons = [ctx.newTroncon(), { ...plain(ctx.newTroncon()), distance_m: 5,
    aval: { fm: 120 }, amont: { fm: 100 } }];
  const c = ctx.computeSynthese(st);
  assert.equal(c.nValid, 1);
  assert.ok(Math.abs(c.penteEstimee - 40) < 1e-9);
});

test('export → import conserve la hauteur d’eau, y compris les valeurs vides', () => {
  const st = ctx.stationFromImport(ref);
  const back = ctx.stationFromImport(plain(ctx.buildExport(st)));
  assert.equal(back.troncons.length, 34);
  assert.equal(back.troncons[0].hauteur_eau_cm, 19);
  assert.equal(back.troncons[33].hauteur_eau_cm, null);
  assert.deepEqual(plain(back.troncons.map(t => [t.aval, t.amont])), plain(ref.troncons.map(t => [t.aval, t.amont])));
});

test('un ancien export sans hauteur d’eau reste importable', () => {
  const old = plain(ref);
  old.troncons.forEach(t => delete t.hauteur_eau_cm);
  const st = ctx.stationFromImport(old);
  assert.ok(st.troncons.every(t => t.hauteur_eau_cm === null));
});
