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

// ---- Propriétés vérifiées sur des transects aléatoires (graine fixe → reproductible)
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function randomTransect(r) {
  const n = 3 + Math.floor(r() * 12), largeur = 2 + r() * 20, verts = [bord(0, 0.5 + r() * 0.4)];
  for (let i = 1; i <= n; i++) {
    const x = +(largeur * i / (n + 1)).toFixed(2), D = 0.1 + r();
    const pts = r() < 0.5 ? [P(0.4, r() * 2)] : [P(0.2, r() * 2), P(0.8, r() * 2)];
    verts.push(r() < 0.15 && i > 1 && i < n ? vert(x, D, [], { isBathy: true }) : vert(x, D, pts));
  }
  verts.push(bord(+largeur.toFixed(2)));
  return verts;
}
const clone = v => JSON.parse(JSON.stringify(v));

test('propriétés : Q = Σ débits partiels, S = Σ surfaces, Vmoy = Q/S', () => {
  const r = rng(1);
  for (let k = 0; k < 50; k++) {
    const res = run(randomTransect(r));
    close(res.Q, res.partials.reduce((s, p) => s + p.Q, 0), 1e-9);
    close(res.S, res.partials.reduce((s, p) => s + p.S, 0), 1e-9);
    if (res.S > 0) close(res.Vmoy, res.Q / res.S, 1e-12);
    close(res.partials.reduce((s, p) => s + p.L, 0), res.L, 1e-9);   // les largeurs d'influence couvrent la section
  }
});

test('propriétés : Q proportionnel aux vitesses et aux profondeurs', () => {
  const r = rng(2);
  for (let k = 0; k < 30; k++) {
    const t = randomTransect(r), Q = run(clone(t)).Q;
    const t2 = clone(t); t2.forEach(v => v.points.forEach(p => { p.v *= 3; }));
    close(run(t2).Q, 3 * Q, 1e-9);
    // profondeurs × 4 : surface × 4 ; Froude conservé → vitesses bathy × 2 ; mesurées inchangées
    const t3 = clone(t); t3.forEach(v => { v.profondeur *= 4; });
    const hasBathy = t.some(v => v.isBathy);
    if (!hasBathy) close(run(t3).Q, 4 * Q, 1e-9);
  }
});

test('propriétés : résultat indépendant du sens de saisie (rive gauche ↔ rive droite) et d’un décalage des abscisses', () => {
  const r = rng(3);
  for (let k = 0; k < 30; k++) {
    const t = randomTransect(r), Q = run(clone(t)).Q, Lw = t[t.length - 1].abscisse;
    const miroir = clone(t).map(v => ({ ...v, abscisse: +(Lw - v.abscisse).toFixed(6) }));
    // le coefficient de rive suit sa berge
    const [cg, cd] = [t[0].coeffRive, t[t.length - 1].coeffRive];
    miroir.find(v => v.abscisse === 0).coeffRive = cd; miroir.find(v => Math.abs(v.abscisse - Lw) < 1e-9).coeffRive = cg;
    close(run(miroir).Q, Q, 1e-9);
    close(run(clone(t).map(v => ({ ...v, abscisse: v.abscisse + 12.5 }))).Q, Q, 1e-9);
  }
});

test('vitesse moyenne : un profil uniforme donne la même vitesse quelle que soit la méthode', () => {
  const zs = [[0.4], [0.2, 0.8], [0.2, 0.4, 0.8], [0, 0.2, 0.4, 0.8, 1], [0, 0.2, 0.4, 0.6, 0.8, 1]];
  for (const z of zs) close(ctx.meanVelocity(z.map(zr => P(zr, 0.73))), 0.73);
});

test('incertitude ISO 748 : diminue quand le nombre de verticales augmente, jamais sous √(u_s² + u_m²)', () => {
  const canal = n => [bord(0), ...Array.from({ length: n }, (_, i) => vert((i + 1) * 10 / (n + 1), 1, [P(0.2, 1), P(0.8, 1)])), bord(10)];
  let prev = Infinity;
  for (const n of [3, 8, 13, 18, 23, 33, 40]) {
    const u = run(canal(n)).uncertainty;
    assert.ok(u.u_Q < prev, `n=${n}`); prev = u.u_Q;
    assert.ok(u.u_Q >= Math.hypot(u.u_s, u.u_m));
  }
});
