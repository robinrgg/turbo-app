import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineScripts, loadFunctions } from './helpers.mjs';

const src = inlineScripts('apps/jaugeage/index.html');
const ctx = loadFunctions(src,
  ['near', 'meanVelocity', 'computeAll', 'surroundingCompleteIdx', 'computeUncertaintyISO748']);
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

const P = (z_rel, v) => ({ z_rel, v });
const vert = (abscisse, profondeur, points = [], extra = {}) =>
  ({ id: 'v' + abscisse, abscisse, profondeur, isBord: false, isBathy: false, coeffRive: null, points, ...extra });
const bord = (abscisse, coeffRive = 0.67) => vert(abscisse, 0, [], { isBord: true, coeffRive });
const run = verticales => { ctx.state = { verticales }; return ctx.computeAll(); };

test('vitesse moyenne : méthodes à 1, 2, 3, 5 et 6 points (ISO 748)', () => {
  close(ctx.meanVelocity([P(0.4, 0.8)]), 0.8);
  close(ctx.meanVelocity([P(0.2, 1), P(0.8, 2)]), 1.5);
  close(ctx.meanVelocity([P(0.2, 1), P(0.4, 2), P(0.8, 3)]), 2);
  close(ctx.meanVelocity([P(0, 1), P(0.2, 2), P(0.4, 3), P(0.8, 4), P(1, 5)]), (1 + 4 + 9 + 12 + 5) / 10);
  close(ctx.meanVelocity([P(0, 1), P(0.2, 1), P(0.4, 1), P(0.6, 1), P(0.8, 1), P(1, 1)]), 1);
});

test('vitesse moyenne : profil quelconque intégré par trapèzes (0 au fond)', () => {
  // points à 0,5 et 1 : v=0 ajouté au fond → aire = 0,5·0,5/2 + 0,5·(0,5+1)/2
  close(ctx.meanVelocity([P(0.5, 0.5), P(1, 1)]), 0.125 + 0.375);
  close(ctx.meanVelocity([]), 0);
  close(ctx.meanVelocity([P(NaN, 1)]), 0);
});

test('débit section médiane : canal rectangulaire de 4 m, 1 m d’eau, 1 m/s', () => {
  const r = run([bord(0), vert(1, 1, [P(0.4, 1)]), vert(2, 1, [P(0.4, 1)]), vert(3, 1, [P(0.4, 1)]), bord(4)]);
  close(r.Q, 3); close(r.S, 3); close(r.Vmoy, 1); close(r.L, 4);
  assert.equal(r.partials.length, 5);
  assert.ok(r.uncertainty && r.uncertainty.u_Q > 0);
});

test('verticales saisies dans le désordre : triées par abscisse', () => {
  const r = run([vert(3, 1, [P(0.4, 1)]), bord(4), vert(1, 1, [P(0.4, 1)]), bord(0), vert(2, 1, [P(0.4, 1)])]);
  close(r.Q, 3);
});

test('bord : vitesse = coefficient de rive × verticale adjacente', () => {
  const r = run([{ ...bord(0, 0.5), profondeur: 0.5 }, vert(1, 1, [P(0.4, 2)]), bord(2)]);
  close(r.verts[0].V_moy, 1);
  close(r.verts[2].V_moy, 0.67 * 2);
});

test('verticale bathymétrique : Froude interpolé, nul sans encadrement', () => {
  const r = run([bord(0), vert(1, 1, [P(0.4, 1)]), vert(2, 1, [], { isBathy: true }), vert(3, 1, [P(0.4, 1)]), bord(4)]);
  close(r.verts[2].V_moy, 1);                       // même profondeur, même Froude → même vitesse
  const r2 = run([bord(0), vert(1, 1, [], { isBathy: true }), vert(2, 1, [P(0.4, 1)]), bord(3)]);
  close(r2.verts[1].V_moy, 0);                       // pas de verticale complète à gauche
});

test('moins de deux verticales : débit nul sans erreur', () => {
  const r = run([vert(1, 1, [P(0.4, 1)])]);
  assert.equal(r.Q, 0);
  assert.equal(r.uncertainty, null);
});
