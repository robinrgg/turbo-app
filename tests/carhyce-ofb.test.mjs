import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFile } from './helpers.mjs';

const { DB } = loadFile('apps/carhyce/db.js', ['DB'], { window: {} });
const { OFB } = loadFile('apps/carhyce/ofb.js', ['OFB'], { window: {} });
const plain = o => JSON.parse(JSON.stringify(o));

function op() {
  const o = plain(DB.newOperation());
  o.station.code = '06004712'; o.station.libelle = 'Colostre à Riez';
  o.granulometrie.mesures_mm = [22, 13, null, 75.5];
  const t = o.transects[0];
  Object.assign(t, { rive_depart: 'Droite', lpb_m: 4.9, lm_m: 2.75, hpb_m: 0.45, facies_simplifie: 'Plat courant', facies_affine: 'Plat courant' });
  t.points = [
    { distance_m: 0, profondeur_cm: -45, substrat_min: '-', substrat_add_1: '', substrat_add_2: '' },
    { distance_m: 0.4, profondeur_cm: 6, substrat_min: 'GF', substrat_add_1: 'CC', substrat_add_2: 'CC' },
    { distance_m: 0.8, profondeur_cm: -2.5, substrat_min: 'TV', substrat_add_1: 'VS', substrat_add_2: '' },
    { distance_m: 1.2, profondeur_cm: null, substrat_min: '', substrat_add_1: '', substrat_add_2: '' },
  ];
  t.ripisylve_rg.arboree = { presente: true, epaisseur: 'Entre 10 et 25 m', type: 'Naturelle' };
  t.ripisylve_rg.plus_recouvrante = 'Strate arborée';
  t.berge_rg = { materiaux: 'Matériaux naturels', habitats: ['SB', 'VA', 'VS'] };
  o.transects[1].modification.type = 'Suppression';
  return o;
}

test('OFB : point 0 exclu, profondeurs signées transmises telles quelles, codes substrats', () => {
  const p = plain(OFB.payload(op()));
  const t1 = p.transects[0];
  assert.equal(t1.points.length, 3);
  assert.deepEqual(t1.points.map(x => x.prof), ['6', '-2.5', '']);
  assert.deepEqual(t1.points.map(x => x.substrat), ['GF', 'TV', 'NR']);
  assert.deepEqual(t1.points[0].add, ['CC'], 'doublon de substrat additionnel fusionné');
  assert.deepEqual(t1.points[1].add, ['VS']);
});

test('OFB : codes du transect et des berges, VA ignoré', () => {
  const t1 = plain(OFB.payload(op())).transects[0];
  assert.equal(t1.debut, '2');
  assert.equal(t1.facies_simplifie, '3');
  assert.deepEqual([t1.lpb, t1.lm, t1.hpb], ['4.9', '2.75', '0.45']);
  const g = t1.berges.g;
  assert.deepEqual(g.strates[0], { present: true, types: ['2'], epaisseur: '3' });
  assert.equal(g.strates[1].present, false);
  assert.equal(g.absente, false);
  assert.equal(g.dominante, 'Arborescente');
  assert.equal(g.materiau, '4');
  assert.deepEqual(g.habitats, ['SB', 'VS']);
  assert.equal(t1.berges.d.absente, true);
  assert.equal(t1.berges.d.materiau, '0');
});

test('OFB : transects retenus seulement, granulométrie sur 100 cases', () => {
  const p = plain(OFB.payload(op()));
  assert.deepEqual(p.transects.map(t => t.numero), [1, ...Array.from({ length: 13 }, (_, i) => i + 3)]);
  assert.equal(p.granulometrie.length, 100);
  assert.deepEqual(p.granulometrie.slice(0, 5), ['22', '13', '', '75.5', '']);
});

test('OFB : script autonome évaluable, données intégrées', () => {
  const s = OFB.script(op());
  assert.match(s, /^\/\* CARHYCE turbo-app → OFB/);
  assert.ok(s.includes('"numero":1'));
  assert.doesNotThrow(() => new Function(s.replace(/\)\(\{[\s\S]*\}\);\s*$/, ')')));
});
