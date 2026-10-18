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

// ---- Propriétés (relevé réel de référence)
const synth = troncons => { const st = ctx.newStation(); st.troncons = troncons; return ctx.computeSynthese(st); };
const base = () => plain(ctx.stationFromImport(ref).troncons);
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test('propriété : changer la hauteur du niveau entre deux stations ne change pas la pente', () => {
  const t = base(), c0 = synth(t);
  // chaque tronçon décalé d'une constante différente sur ses deux visées (mise en station différente)
  const t2 = t.map((tr, i) => ({ ...tr, aval: { ...tr.aval, fm: tr.aval.fm + 7 * i }, amont: { ...tr.amont, fm: tr.amont.fm + 7 * i } }));
  const c2 = synth(t2);
  near(c2.penteEstimee, c0.penteEstimee); near(c2.penteReg, c0.penteReg);
});

test('propriété : échanger aval et amont inverse le signe de la pente', () => {
  const t = base(), c0 = synth(t);
  const c2 = synth(t.map(tr => ({ ...tr, aval: tr.amont, amont: tr.aval })));
  near(c2.penteEstimee, -c0.penteEstimee); near(c2.penteReg, -c0.penteReg);
});

test('propriété : distances doublées → pente divisée par deux ; dénivelés doublés → pente doublée', () => {
  const t = base(), c0 = synth(t);
  const cD = synth(t.map(tr => ({ ...tr, distance_m: tr.distance_m * 2 })));
  near(cD.penteEstimee, c0.penteEstimee / 2); near(cD.penteReg, c0.penteReg / 2);
  const cH = synth(t.map(tr => ({ ...tr, amont: { ...tr.amont, fm: tr.aval.fm - 2 * (tr.aval.fm - tr.amont.fm) } })));
  near(cH.penteEstimee, 2 * c0.penteEstimee); near(cH.penteReg, 2 * c0.penteReg, 1e-9);
});

test('propriété : l’ordre de saisie compte pour la régression mais pas pour la pente estimée', () => {
  const t = base(), c0 = synth(t), c2 = synth([...t].reverse());
  near(c2.penteEstimee, c0.penteEstimee);
});
