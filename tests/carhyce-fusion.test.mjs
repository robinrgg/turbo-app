import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFile } from './helpers.mjs';

const { DB } = loadFile('apps/carhyce/db.js', ['DB'], { window: {} });
const { Fusion } = loadFile('apps/carhyce/fusion.js', ['Fusion'], { window: {} });
const plain = o => JSON.parse(JSON.stringify(o));

function opAvec(nom, f) { const op = plain(DB.newOperation()); op.id = nom; op.station.libelle = nom; f && f(op); return op; }

test('fusion : chaque onglet vient de la source choisie, les originaux ne sont pas modifiés', () => {
  const A = opAvec('A', op => { op.granulometrie.mesures_mm = [10, 20]; op.pente.troncons = [{ distance_m: 5 }]; op.station.code = 'X1'; });
  const B = opAvec('B', op => { op.granulometrie.mesures_mm = [99]; op.colmatage.classe_archambaud = 'C3'; op.station.code = 'X1'; });
  const avant = JSON.stringify([A, B]);
  const m = plain(Fusion.assembler(A, B, { sections: { station: 'B', granulometrie: 'A', pente: 'A', colmatage: 'B' }, transects: {} }, plain(DB.newOperation())));
  assert.equal(m.station.libelle, 'B (fusion)');
  assert.deepEqual(m.granulometrie.mesures_mm, [10, 20]);
  assert.equal(m.pente.troncons.length, 1);
  assert.equal(m.colmatage.classe_archambaud, 'C3');
  assert.deepEqual(m.meta.fusion_de, ['A', 'B']);
  assert.equal(JSON.stringify([A, B]), avant, 'sources intactes');
});

test('fusion : transects choisis un par un, 18 transects numérotés, état écarté conservé', () => {
  const A = opAvec('A', op => { op.transects[0].points = [{ distance_m: 0 }]; op.transects[16].actif = false; });
  const B = opAvec('B', op => { op.transects[1].lpb_m = 7; op.transects[16].actif = false; op.transects[2].modification.type = 'Suppression'; });
  const m = plain(Fusion.assembler(A, B, { sections: {}, transects: { 1: 'A', 2: 'B', 3: 'B' } }, plain(DB.newOperation())));
  assert.equal(m.transects.length, 18);
  assert.deepEqual(m.transects.map(t => t.numero), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.equal(m.transects[0].points.length, 1);
  assert.equal(m.transects[1].lpb_m, 7);
  assert.equal(m.transects[2].modification.type, 'Suppression');
  assert.equal(m.transects[16].actif, false, 'désactivé des deux côtés → reste désactivé');
  assert.equal(m.transects[4].actif, true, 'non choisi → transect vierge du gabarit');
});

test('fusion : « (fusion) » n’est ajouté qu’une fois', () => {
  const A = opAvec('Station (fusion)');
  const m = Fusion.assembler(A, A, { sections: { station: 'A' }, transects: {} }, plain(DB.newOperation()));
  assert.equal(m.station.libelle, 'Station (fusion)');
});

test('même station : par code (casse et suffixes ignorés), sinon par libellé', () => {
  const s = (code, libelle) => ({ station: { code, libelle } });
  assert.equal(Fusion.memeStation(s('x123', ''), s(' X123 ', '')), true);
  assert.equal(Fusion.memeStation(s('X1', ''), s('X2', '')), false);
  assert.equal(Fusion.memeStation(s('', 'Riez (fusion)'), s('', 'riez')), true);
});

test('statut d’un transect : supprimé, désactivé, complet, partiel, à saisir', () => {
  const tr = () => plain(DB.newOperation()).transects[0];
  const complet = Object.assign(tr(), { lpb_m: 7, lm_m: 5, hpb_m: 1, facies_affine: 'Radier',
    points: Array.from({ length: 8 }, (_, i) => ({ distance_m: i })) });
  complet.berge_rg.materiaux = 'Terre'; complet.berge_rd.materiaux = 'Blocs';
  assert.equal(Fusion.statutTransect(complet).code, 'complet');
  assert.equal(Fusion.statutTransect({ ...plain(complet), points: complet.points.slice(0, 7) }).code, 'partiel');
  assert.equal(Fusion.statutTransect(tr()).code, 'vide');
  assert.equal(Fusion.statutTransect({ ...tr(), actif: false }).code, 'inactif');
  assert.equal(Fusion.statutTransect({ ...tr(), modification: { type: 'Suppression' } }).code, 'supprime');
});
