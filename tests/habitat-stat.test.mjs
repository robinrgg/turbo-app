import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineScripts, loadFunctions } from './helpers.mjs';

const src = inlineScripts('apps/habitat-stat/index.html');
const ctx = loadFunctions(src, ['num', 'rnd', 'todayISO', 'newCampaign', 'newTransect', 'newPoint', 'newStation',
  'spacing', 'suggestPts', 'computeCamp', 'disVector', 'graClass', 'graVector', 'computeCarry',
  'campObj', 'buildModelJSON', 'campFromModel', 'stationFromModel', 'normalize'],
  { GRA_LABELS: Array.from({ length: 12 }, (_, i) => 'c' + i) });
const plain = o => JSON.parse(JSON.stringify(o));
const sum = a => a.reduce((s, x) => s + x, 0);
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test('num : virgule décimale, vide → null', () => {
  assert.equal(ctx.num('1,5'), 1.5);
  assert.equal(ctx.num(''), null);
  assert.equal(ctx.num(null), null);
  assert.equal(ctx.num('abc'), null);
});

test('computeCamp : largeur et hauteur moyennes, substrat seulement si coché', () => {
  const c = { debit: '0,8', substrat: false, transects: [
    { largeur: '4', points: [{ h: '10', s: '30' }, { h: '20', s: '' }] },
    { largeur: '6', points: [{ h: '30', s: '5' }, { h: '', s: '' }] }] };
  const r = ctx.computeCamp(c);
  assert.equal(r.Q, 0.8); close(r.Wm, 5); close(r.Hcm, 20); close(r.Hm, 0.2);
  assert.equal(r.nPts, 3); assert.equal(r.hasSub, false); assert.equal(r.meanSubCm, null);
  const r2 = ctx.computeCamp({ ...c, substrat: true });
  assert.equal(r2.hasSub, true); close(r2.meanSubCm, (30 + 5) / 2 / 10);
});

test('disVector : 20 classes de largeur H/4, somme = 1, profondeurs > 5H dans la dernière', () => {
  const dep = [0, 4, 5, 9.99, 10, 39, 200];        // Hcm = 20 → classes de 5 cm
  const f = ctx.disVector(dep, 20);
  assert.equal(f.length, 20);
  close(sum(f), 1, 1e-4);
  close(f[0], 2 / 7, 1e-5);                        // 0 et 4
  close(f[1], 2 / 7, 1e-5);                        // 5 et 9,99
  close(f[2], 1 / 7, 1e-5);                        // 10
  close(f[7], 1 / 7, 1e-5);                        // 39
  close(f[19], 1 / 7, 1e-5);                       // 200 > 5H → dernière classe
  assert.deepEqual(plain(ctx.disVector([], null)), new Array(20).fill(0));
});

test('disVector : la distribution se recentre si toutes les profondeurs doublent (invariance d’échelle)', () => {
  const dep = [3, 8, 12, 17, 25, 31, 40];
  const H = sum(dep) / dep.length;
  assert.deepEqual(plain(ctx.disVector(dep, H)), plain(ctx.disVector(dep.map(d => 2 * d), 2 * H)));
});

test('graClass : bornes des classes granulométriques (axe b en mm)', () => {
  const cas = [[0, 1], [0.1, 2], [0.5, 2], [0.51, 3], [2, 3], [2.1, 4], [10, 4], [20, 5], [30, 6],
    [60, 7], [120, 8], [250, 9], [1000, 10], [1001, 11]];
  for (const [mm, k] of cas) assert.equal(ctx.graClass(mm), k, `${mm} mm`);
});

test('graVector : fréquences sommant à 1, classe 0 (détritus) jamais attribuée', () => {
  const f = ctx.graVector([0, 1, 15, 15, 45, 300, 2000]);
  close(sum(f), 1, 1e-4);
  assert.equal(f[0], 0);
  close(f[5], 2 / 7, 1e-5);
});

test('suggestPts : environ largeur / (Lm/7), au moins 3 points', () => {
  assert.equal(ctx.suggestPts(7, { lm: '7' }), 7);
  assert.equal(ctx.suggestPts(1, { lm: '7' }), 3);
  assert.equal(ctx.suggestPts(7, { lm: '' }), 0);
});

// Report continu entre transects : distance « fin du transect i → début du i+1 » = un pas.
function checkCarry(lm, largeurs) {
  const c = { lm: String(lm), transects: largeurs.map(w => ({ largeur: String(w), points: [] })) };
  const d = lm / 7, pos = ctx.computeCarry(c);
  let reliquat = d / 2;                               // 1er point à d/2 de la berge
  pos.forEach((ps, i) => {
    const w = largeurs[i];
    if (ps.length === 1 && w < reliquat) { reliquat -= w; return; }   // transect plus étroit que le pas
    close(ps[0], reliquat, 0.011);
    for (let k = 1; k < ps.length; k++) close(ps[k] - ps[k - 1], d, 0.011);
    assert.ok(ps[ps.length - 1] <= w + 1e-9);
    reliquat = d - (w - ps[ps.length - 1]);
  });
}

test('computeCarry : pas constant Lm/7 et report continu d’un transect à l’autre', () => {
  checkCarry(7, [3, 2.6, 4.2, 5]);
  checkCarry(10.5, [6.3, 8.1, 7.7, 9.9, 5.2]);
});

test('computeCarry : dernier point pile sur la berge → le suivant est à un pas, pas sur la berge', () => {
  checkCarry(7, [3.5, 3]);                            // points 0,5…3,5 : le dernier tombe sur la berge
});

test('export modélisation → import : aucune donnée perdue', () => {
  const op = ctx.newStation();
  Object.assign(op.station, { code: 'X123', ce: 'Colostre', long: '150', pb: '8', nbt: '15', q50: '0.5', qmin: '0.1', qmax: '3', pente: '2.5', chutes: '1.2' });
  Object.assign(op.camp1, { debit: '0.3', lm: '5', substrat: true,
    transects: [{ largeur: '4.5', points: [{ h: '12', s: '40' }, { h: '20', s: '0' }] }] });
  Object.assign(op.camp2, { debit: '1.1', lm: '6', transects: [{ largeur: '5.5', points: [{ h: '30', s: '' }] }] });
  const json = plain(ctx.buildModelJSON(op));
  close(json.model_inputs.qhw.H1, 0.16); close(json.model_inputs.qhw.W2, 5.5);
  assert.equal(json.model_inputs.gra.source, 'Q1');
  close(json.model_inputs.estimhab.substrat_axe_b_moyen_cm, 2);
  const back = plain(ctx.normalize(json));
  for (const k of ['code', 'ce', 'long', 'pb', 'nbt', 'q50', 'qmin', 'qmax', 'pente', 'chutes'])
    assert.equal(Number(back.station[k]) || back.station[k], Number(op.station[k]) || op.station[k], k);
  assert.equal(back.camp1.transects[0].points[1].s, '0');
  assert.equal(back.camp2.transects[0].points[0].h, '30');
  // Ré-exporter l'import donne les mêmes entrées de modèle
  const again = plain(ctx.buildModelJSON({ station: back.station, camp1: back.camp1, camp2: back.camp2 }));
  assert.deepEqual(again.model_inputs, json.model_inputs);
});
