// App ICE (protocole de terrain Onema, décembre 2015) : calculs des fiches 2 et 3, puis parcours dans la vraie page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineScripts, loadFunctions } from './helpers.mjs';
import { hasBrowser, withBrowser } from './browser.mjs';

const src = inlineScripts('apps/ice/index.html');
const c = loadFunctions(src, ['num', 'chute', 'penteOuvrage', 'diagonale', 'ouvertureVanne', 'typeJet', 'profil']);
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
const skip = !hasBrowser && 'Playwright absent';

test('lectures de mire : chute = ligne aval - ligne amont (virgule acceptée)', () => {
  close(c.chute('0,85', '2,10'), 1.25);
  assert.equal(c.chute('', '1'), null);
});

test('pente d’un coursier : 100 × DHouv / √(L² - DHouv²), longueur suivant l’ouvrage', () => {
  close(c.penteOuvrage(5, 1.0, 4.0), 75);                 // DH 3 m sur 5 m suivant l'ouvrage → 3/4
  close(c.penteOuvrage('10', '0,5', '1,1'), 100 * 0.6 / Math.sqrt(100 - 0.36));
  assert.equal(c.penteOuvrage(1, 0, 2), null, 'longueur inférieure au dénivelé');
});

test('redan : c = √(a² + b²) ; vanne : OV = contact - (haut + hauteur)', () => {
  close(c.diagonale(0.3, 0.4), 0.5);
  close(c.ouvertureVanne(3.2, 1.5, 1.2), 0.5);           // lectures : bas de vanne à 2,7, radier à 3,2
});

test('type de jet : surface < 0,5 × tirant, quasi-surface ≤ 1 ×, plongeant au-delà', () => {
  assert.equal(c.typeJet(0.04, 0.10), 'Surface');
  assert.equal(c.typeJet(0.08, 0.10), 'Quasi-surface');
  assert.equal(c.typeJet(0.15, 0.10), 'Plongeant');
  assert.equal(c.typeJet(0.1, ''), null);
});

// Exemple du protocole (§ 5.1.4) : même profil relevé en distances horizontales puis suivant l'ouvrage (cm → m)
const cotes = [41, 37, 36, 48, 79, 94, 94, 117, 154, 137].map(v => v / 100);
const horiz = [0, 30, 20, 20, 17, 0, 48, 0, 57, 78].map(v => v / 100);
const suiv = [0, 30, 20, 23, 35, 15, 48, 23, 68, 80].map(v => v / 100);
const pts = d => cotes.map((z, i) => ({ z: String(z), d: String(d[i]) }));

test('profil en long : les deux méthodes de mesure de l’exemple du protocole donnent le même profil', () => {
  const h = c.profil(pts(horiz), 'Horizontale'), s = c.profil(pts(suiv), "Suivant l'ouvrage");
  assert.equal(h.n, 10); close(h.dh, 0.96); close(s.dh, 0.96);
  h.x.forEach((x, i) => close(x, s.x[i], 0.04));          // abscisses horizontales cumulées concordantes (arrondis au cm)
  assert.equal(h.penteMax, Infinity, 'décrochements verticaux (distance horizontale nulle)');
  assert.equal(s.penteMax, Infinity, 'décrochement : distance suivant l’ouvrage = dénivelé');
  assert.equal(h.vertical, true); assert.equal(s.incoherent, false);
});

test('profil en long : pente la plus raide, longueur suivant l’ouvrage, incohérence signalée', () => {
  const p = c.profil([{ z: '1' }, { z: '1.5', d: '1' }, { z: '1.6', d: '1' }], 'Horizontale');
  close(p.penteMax, 50); close(p.longueur, Math.sqrt(1.25) + Math.sqrt(1.01)); assert.equal(p.vertical, false);
  assert.equal(c.profil([{ z: '1' }, { z: '2', d: '0.5' }], "Suivant l'ouvrage").incoherent, true);
});

test('ICE : saisie d’un ouvrage, formulaires conditionnels, export et réimport', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/ice/index.html');
    await page.click('#btnNew');
    const r = await page.evaluate(async () => {
      const op = cur;
      Object.assign(op.f1a, { nom: 'Moulin du Pont', roe: 'ROE1234', lat: '45.1', lon: '3.2', etat: 'Existant', typo_famille: 'Seuil en rivière', chute_mode: 'Mesurée', chute_m: '1.2' });
      Object.assign(op.f2, { ref_cote: '1.000', ref_desc: 'Crête RD', l_amont: '0.80', l_aval: '2.00', larg_mouillee: '8' });
      touch(); go('op');
      const out = { manquantsAvant: manquants(op).map(x => x.lib) };
      go('parties');
      return out;
    });
    assert.deepEqual(r.manquantsAvant, ["Au moins une partie d'ouvrage"]);
    // partie en enrochements : le bloc « Seuils en enrochements » apparaît, pas celui des ouvrages routiers
    await page.click('#btnAddP');
    await page.check('input[name="typeStruct"][value="enrochement"]');
    await page.click('#modalOk');
    await page.waitForSelector('#scr-partie.active');                // nouvelle partie : fiche de la partie d'abord
    await page.click('#scr-partie [data-s="0"]');
    assert.match(await page.textContent('#scr-struct'), /Seuil en enrochements/);
    await page.click('#btnBack');
    let txt = await page.textContent('#scr-partie');
    assert.match(txt, /Arrangement des blocs/); assert.doesNotMatch(txt, /Luminosité/);
    // voie de reptation : le bloc de la fiche 3 verso n'apparaît que si « Oui »
    assert.doesNotMatch(txt, /Profil spécifique/);
    await page.locator('#scr-partie .field', { hasText: 'Voie continue pour la reptation' }).locator('.chip[data-v="Oui"]').click();
    assert.match(await page.textContent('#scr-partie'), /Profil spécifique/);
    // ajout d'une structure routière : ouvrage complexe, bloc routier visible
    await page.click('#btnAddS');
    await page.check('input[name="typeStruct"][value="routier"]');
    await page.click('#modalOk');
    await page.waitForSelector('#scr-struct.active');
    txt = await page.textContent('#scr-struct');
    assert.match(txt, /structure 2 \/ 2/); assert.match(txt, /lignes d'eau de la structure/); assert.match(txt, /Présence de chute aval/);
    await page.click('#btnBack');
    assert.match(await page.textContent('#scr-partie'), /Luminosité/);
    // mesures et calculs exportés
    const exp = await page.evaluate(() => {
      const p = cur.parties[0];
      Object.assign(p.structures[0], { longueur: '5', radier_am: '1', radier_av: '4', l_amont: '1', l_aval: '2', tirant_min: '0.2', redans_oui: 'Non' });
      Object.assign(p.structures[1], { l_amont: '0.8', l_aval: '1', tirant_min: '0.1', chute_aval: 'Oui', ch_amont: '0.9', ch_aval: '1.0', ch_charge: '0.05', fosse: '0.4', redans_oui: 'Non' });
      Object.assign(p, { largeur: '6', ecoulement: 'Oui', reptation: 'Non' });
      return buildExport(cur);
    });
    assert.equal(exp.format, 'ice-saisie');
    assert.equal(exp.calculs.chute_globale_m, 1.2);
    assert.equal(exp.calculs.parties[0].structures[0].pente_pct, 75);
    assert.equal(exp.calculs.parties[0].structures[1].chute_aval, 0.1);
    assert.equal(exp.calculs.parties[0].structures[1].jet_suggere, 'Plongeant');
    assert.deepEqual(exp.manquants, []);
    const back = await page.evaluate(e => { const o = normalize(JSON.parse(JSON.stringify(e))); return { nom: o.f1a.nom, n: o.parties[0].structures.length, id: o.id !== e.ouvrage.id }; }, exp);
    assert.deepEqual(back, { nom: 'Moulin du Pont', n: 2, id: true });
    assert.deepEqual(page.errors, []);
  });
});

test('ICE : seuil incliné, profil en long saisi point par point, contrôle du type', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/ice/index.html');
    await page.evaluate(() => { cur = newOuvrage(); const p = newPartie(); p.structures = [newStructure('incline')]; cur.parties.push(p); Store.put(cur); go('op'); go('parties'); go('partie', 0); go('struct', 0); });
    await page.click('#scr-struct .chip[data-v="Horizontale"]');
    const z = ['1', '1.2', '1.9'], d = ['', '1', '0.5'];
    await page.click('[data-ptadd="st"]');
    for (let i = 0; i < 3; i++) {
      await page.fill(`[data-pt="st"][data-i="${i}"][data-f="z"]`, z[i]);
      if (i) await page.fill(`[data-pt="st"][data-i="${i}"][data-f="d"]`, d[i]);
    }
    const resume = await page.textContent('[data-prof="st"]');
    assert.match(resume, /Pente la plus raide :\s*140\.0 %/);
    assert.equal(await page.locator('svg.profil circle').count(), 3);
    assert.deepEqual(await page.evaluate(() => cur.parties[0].structures[0].points.map(p => p.z)), z);
    // profil réalisable : redans et chute aval déclarés (obligatoires), dimensions affichées sur « Oui »
    let txt = await page.textContent('#scr-struct');
    assert.match(txt, /Présence de redans/); assert.match(txt, /Présence de chute aval/); assert.doesNotMatch(txt, /Hauteur de chute aval/);
    assert.deepEqual(await page.evaluate(() => manquants(cur).map(m => m.lib).filter(l => /redans|chute aval/.test(l))),
      ['Partie 1 : présence de redans', 'Partie 1 : présence de chute aval']);
    await page.evaluate(() => { Object.assign(cur.parties[0].structures[0], { chute_aval_oui: 'Oui' }); FORM.rerender(); });
    assert.match(await page.textContent('#scr-struct'), /Hauteur de chute aval/);
    // profil non réalisable : champs d'estimation du seuil incliné (tirant d'eau, redan, chute aval)
    await page.click('#scr-struct .chip[data-v="Non"]');
    const t = await page.textContent('#scr-struct');
    assert.match(t, /Redan le plus pénalisant/); assert.match(t, /Tirant d'eau de chute aval/); assert.doesNotMatch(t, /Cote de fond/);
    assert.deepEqual(page.errors, []);
  });
});

test('ICE fiche 1a : carte de localisation sous « Utiliser ma position », conservée quand la fiche se redessine', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/ice/index.html');                 // fond de carte bloqué en test : message de repli
    await page.click('#btnNew');
    const avant = await page.evaluate(() => { window._carte = document.querySelector('#mapSlot .mapbox'); return !!window._carte; });
    assert.equal(avant, true);
    assert.match(await page.textContent('#mapSlot'), /Carte indisponible/);
    await page.selectOption('#scr-form select >> nth=0', 'Existant');   // un choix redessine la fiche
    assert.equal(await page.evaluate(() => document.querySelector('#mapSlot .mapbox') === window._carte), true);
    await page.click('#btnBack');
    assert.equal(await page.evaluate(() => CARTE.watch), null, 'GPS arrêté hors de la fiche 1a');
    assert.deepEqual(page.errors, []);
  });
});

test('ICE C2 : deuxième campagne, recalage sur le point de référence, mesures dépendant du débit', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/ice/index.html');
    await page.evaluate(() => {
      cur = newOuvrage(); Object.assign(cur.f2, { ref_cote: '0.500', l_amont: '0.80', l_aval: '2.00' });
      const p = newPartie(); p.structures = [newStructure('vertical'), newStructure('routier')]; p.structures[1].chute_aval = 'Oui';
      cur.parties.push(p); Store.put(cur); go('op');
    });
    await page.click('[data-go="c2"]');
    const txt = await page.textContent('#scr-c2');
    assert.match(txt, /Crête|non décrit/); assert.match(txt, /Charge sur l'obstacle/); assert.match(txt, /Vitesse en sortie/);
    assert.match(txt, /Cote niveau amont de la chute/, 'chute aval saisie en C1 : mesures de chute demandées');
    // niveau déplacé : point de référence lu 0,300 au lieu de 0,500 -> décalage +0,200
    const champ = lib => page.locator('#scr-c2 .field', { hasText: lib }).locator('input').first();
    await champ('Lecture du point de référence (C2)').fill('0.300');
    await champ("Cote ligne d'eau amont (lecture C2)").fill('0.50');
    await champ("Cote ligne d'eau aval (lecture C2)").fill('1.60');
    assert.match(await page.textContent('#scr-c2'), /chute C2 :\s*1\.10 m \(C1 : 1\.20 m\)/);
    const exp = await page.evaluate(() => buildExport(cur));
    assert.equal(exp.calculs.c2.decalage_m, 0.2);
    assert.equal(exp.calculs.c2.chute_globale_m, 1.1);
    assert.deepEqual(Object.keys(exp.ouvrage.c2.structures).sort(), ['0.0', '0.1']);
    assert.ok(!exp.manquants.some(m => /C2/.test(m)));
    assert.deepEqual(page.errors, []);
  });
});
