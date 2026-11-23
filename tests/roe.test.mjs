// App ROE (fiche n°1a « Référence ROE ») : règles de saisie, format d'export et fusion à l'import,
// puis parcours complet dans la vraie page (photos, rechargement, export, réimport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inlineScripts, loadFunctions, extractConst } from './helpers.mjs';
import { hasBrowser, withBrowser } from './browser.mjs';

const src = inlineScripts('apps/roe/index.html');
const c = loadFunctions(src, ['todayISO', 'newFiche', 'num', 'vide', 'coordsValides', 'manquants', 'ficheVierge', 'basculerUsage', 'basculerPasse',
  'dimensionsReduites', 'tailleKo', 'sansAccents', 'baseNom', 'nomFichier', 'nomPhoto', 'paquet', 'normalizeFiche', 'lireImport', 'fusionner',
  'wfsUrl', 'compacter', 'contient', 'roeEnMemoire', 'typeDepuisCode', 'fmtDate', 'lignesROE', 'ficheDepuisROE'],
  { FORMAT: 'roe-saisie', VERSION: 1, MAX_PHOTOS: 2, WFS_ROE: 'https://services.sandre.eaufrance.fr/geo/obs', encodeURIComponent });
for (const k of ['NOM', 'TYPE_SANDRE', 'PROPS_ROE']) vm.runInContext(extractConst(src, k), c);
const skip = !hasBrowser && 'Playwright absent';
const plain = o => JSON.parse(JSON.stringify(o));

test('champs obligatoires de la fiche 1a : nom, coordonnées valides, état, typologie', () => {
  const fi = c.newFiche();
  assert.deepEqual(plain(c.manquants(fi).map(x => x.lib)), ["Nom de l'ouvrage", 'Coordonnées GPS (WGS84)', 'Etat', 'Typologie']);
  Object.assign(fi, { nom: 'Moulin', lat: '43,869668', lon: '5.098666', etat: 'Existant', typo_type: 'Seuil en rivière' });
  assert.deepEqual(plain(c.manquants(fi)), []);
  fi.lat = '143';                                         // hors plage
  assert.equal(c.manquants(fi).length, 1);
});

test('fiche vierge détectée (fiche ouverte puis abandonnée)', () => {
  const fi = c.newFiche();
  assert.equal(c.ficheVierge(fi), true);
  fi.usages.push('Inconnu');
  assert.equal(c.ficheVierge(fi), false);
});

test('usages : un sous-usage coche son parent, décocher le parent retire ses sous-usages, ordre de la fiche', () => {
  const fi = c.newFiche();
  c.basculerUsage(fi, 'Baignade', true);
  c.basculerUsage(fi, 'Inconnu', true);
  assert.deepEqual(plain(fi.usages), ['Inconnu', 'Loisirs', 'Baignade']);
  c.basculerUsage(fi, 'Loisirs', false);
  assert.deepEqual(plain(fi.usages), ['Inconnu']);
  c.basculerUsage(fi, 'Pêche professionnelle', true);
  c.basculerUsage(fi, 'Pêche professionnelle', false);
  assert.deepEqual(plain(fi.usages), ['Inconnu', 'Activité aquacole']);
});

test('passes : positions multiples dans l’ordre RG, milieu, RD ; type retiré sans position', () => {
  const fi = c.newFiche();
  c.basculerPasse(fi, 'Prébarrage', 'Rive droite');
  c.basculerPasse(fi, 'Prébarrage', 'Rive gauche');
  assert.deepEqual(plain(fi.passes), { 'Prébarrage': ['Rive gauche', 'Rive droite'] });
  c.basculerPasse(fi, 'Prébarrage', 'Rive gauche'); c.basculerPasse(fi, 'Prébarrage', 'Rive droite');
  assert.deepEqual(plain(fi.passes), {});
});

test('photos : réduction au grand côté sans agrandissement, taille estimée', () => {
  assert.deepEqual(plain(c.dimensionsReduites(4000, 3000, 1600)), { w: 1600, h: 1200 });
  assert.deepEqual(plain(c.dimensionsReduites(3000, 4000, 1600)), { w: 1200, h: 1600 });
  assert.deepEqual(plain(c.dimensionsReduites(800, 600, 1600)), { w: 800, h: 600 });
  assert.equal(c.tailleKo('data:image/jpeg;base64,' + 'A'.repeat(4096)), 3);
});

test('noms de fichiers : sans accents ni caractères spéciaux', () => {
  const fi = Object.assign(c.newFiche(), { nom: "Seuil de l'Écluse n°2", date: '2026-11-23' });
  assert.equal(c.nomFichier([fi]), 'ROE_Seuil_de_l_Ecluse_n_2_2026-11-23.json');
  assert.equal(c.nomPhoto(fi, 1), 'ROE_Seuil_de_l_Ecluse_n_2_2026-11-23_photo2.jpg');
  fi.roe_id = 'ROE12345';
  assert.equal(c.nomFichier([fi]), 'ROE_ROE12345_2026-11-23.json');
  assert.match(c.nomFichier([fi, fi]), /^ROE_fiches_\d{4}-\d{2}-\d{2}\.json$/);
});

test('import : format vérifié, fiches complétées, photos invalides et surnuméraires écartées', () => {
  assert.throws(() => c.lireImport({ format: 'ice-saisie', fiches: [] }));
  assert.throws(() => c.lireImport({ format: 'roe-saisie' }));
  const img = 'data:image/jpeg;base64,AAAA';
  const [fi] = c.lireImport({ format: 'roe-saisie', fiches: [{ id: 'roe_x', updated: 5, nom: 'A', usages: 'faux',
    photos: [{ data: img }, { data: 'javascript:alert(1)' }, { data: img }, { data: img }] }, null] });
  assert.equal(fi.id, 'roe_x'); assert.equal(fi.updated, 5); assert.equal(fi.nom, 'A');
  assert.deepEqual(plain(fi.usages), []); assert.deepEqual(plain(fi.passes), {});
  assert.equal(fi.photos.length, 2); assert.equal(fi.photos[0].legende, '');
});

test('import : ajout, mise à jour si plus récente, sinon ignorée', () => {
  const ex = { a: { id: 'a', updated: 10 }, b: { id: 'b', updated: 10 } };
  const r = c.fusionner(ex, [{ id: 'a', updated: 20 }, { id: 'b', updated: 10 }, { id: 'c', updated: 1 }]);
  assert.deepEqual([r.ajout, r.maj, r.ignore], [1, 1, 1]);
  assert.deepEqual(plain(r.aEcrire.map(x => x.id)), ['a', 'c']);
});

test('aller-retour export → import : fiche identique', () => {
  const fi = Object.assign(c.newFiche(), { nom: 'Moulin', lat: '43.1', lon: '5.2', mobiles: ['Hausses'], passes: { 'Prébarrage': ['Milieu'] },
    photos: [{ data: 'data:image/jpeg;base64,AAAA', w: 10, h: 8, legende: 'amont', date: '2026-11-23T10:00:00Z' }] });
  const back = c.lireImport(JSON.parse(JSON.stringify(c.paquet([fi]))));
  assert.deepEqual(plain(back[0]), plain(fi));
});

// ---- Flux public du ROE (Sandre)
const entite = (code, props = {}, coords = [5.130219, 43.921419]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords },
  properties: { CdObstEcoul: code, NomPrincipalObstEcoul: 'Seuil VALDOR', LbEtOuvrage: 'Existant', CdTypeOuvrage: '1.2.1', NomSecondaireObstEcoul: '',
    HautChutEtObstEcoul: '1.88', LbHautChutClObstEcoul: 'De 1.5m à inférieure à 2m', LbUsageObstEcoul1: 'Alimentation en eau potable',
    LbUsageObstEcoul2: "Stabilisation du profil en long du lit, lutte contre l'érosion", NomEntiteHydrographique: 'rivière la sorgue',
    LbCommune: 'FONTAINE-DE-VAUCLUSE', CdDepartement: '84', DateMAJObstEcoul: '2023-09-01T00:00:00', gid: 1, ...props } });

test('WFS : emprise en lat/lon EPSG:4326, nombre seul ou GeoJSON avec les seuls attributs utiles', () => {
  const h = new URL(c.wfsUrl([43.8, 5, 43.95, 5.2], true));
  assert.equal(h.searchParams.get('BBOX'), '43.8,5,43.95,5.2,urn:ogc:def:crs:EPSG::4326');
  assert.equal(h.searchParams.get('RESULTTYPE'), 'hits');
  assert.equal(h.searchParams.get('TYPENAMES'), 'sa:ObstEcoul');
  const g = new URL(c.wfsUrl([43.8, 5, 43.95, 5.2], false));
  assert.equal(g.searchParams.get('OUTPUTFORMAT'), 'application/json; subtype=geojson');
  assert.ok(g.searchParams.get('PROPERTYNAME').split(',').includes('msGeometry'));
});

test('types Sandre : chaque code correspond à un type et un sous type de la fiche', () => {
  for (const [cd, [t, st]] of Object.entries(c.TYPE_SANDRE)) {
    assert.ok(c.NOM.typo[t], cd);
    if (st) assert.ok(c.NOM.typo[t].includes(st), `${cd} : ${st}`);
  }
  assert.deepEqual(plain(c.typeDepuisCode('1.1.6')), ['Barrage', 'Barrage mobile']);
  assert.equal(c.typeDepuisCode('9.9'), null);
});

test('entité compactée : attributs vides et inutiles retirés, coordonnées arrondies', () => {
  const r = c.compacter(entite('ROE53049'));
  assert.equal(r.c, 'ROE53049'); assert.equal(r.x, 5.130219); assert.equal(r.y, 43.921419);
  assert.equal('NomSecondaireObstEcoul' in r.p, false); assert.equal('gid' in r.p, false);
  assert.equal(c.compacter({ type: 'Feature', geometry: null, properties: { CdObstEcoul: 'ROE1' } }), null);
});

test('zones : union, la zone la plus récente l’emporte ; emprise contenue', () => {
  const z1 = { date: '2026-01-01', roe: [{ c: 'A', v: 1 }, { c: 'B', v: 1 }] }, z2 = { date: '2026-06-01', roe: [{ c: 'B', v: 2 }] };
  const u = c.roeEnMemoire([z2, z1]);
  assert.equal(u.length, 2); assert.equal(u.find(r => r.c === 'B').v, 2);
  assert.equal(c.contient([43, 3, 45, 6], [43.5, 4, 44, 5]), true);
  assert.equal(c.contient([43.5, 4, 44, 5], [43, 3, 45, 6]), false);
});

test('fiche d’information et fiche pré-remplie à partir d’un ROE existant', () => {
  const r = c.compacter(entite('ROE53049'));
  const l = Object.fromEntries(plain(c.lignesROE(r.p)));
  assert.equal(l['Type'], 'Seuil en rivière / Déversoir');
  assert.equal(l['Hauteur de chute'], '1,88 m · De 1.5m à inférieure à 2m');
  assert.equal(l['Commune'], 'FONTAINE-DE-VAUCLUSE (84)');
  assert.equal(l['Mise à jour ROE'], '01/09/2023');
  const fi = c.ficheDepuisROE(r);
  assert.deepEqual([fi.roe_id, fi.nom, fi.cours_eau, fi.lat, fi.lon, fi.etat, fi.typo_type, fi.typo_sous],
    ['ROE53049', 'Seuil VALDOR', 'rivière la sorgue', '43.921419', '5.130219', 'Existant', 'Seuil en rivière', 'Déversoir']);
  assert.deepEqual(plain(c.manquants(fi)), []);
});

test('ROE : saisie, photo réduite, rechargement, export puis réimport', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/roe/index.html');
    await page.waitForFunction(() => document.querySelector('#scr-home.active'));
    await page.click('#btnNew');
    await page.locator('#sec-id .field', { hasText: "Nom de l'ouvrage" }).locator('input').fill('Seuil du Moulin');
    await page.fill('#inLat', '43.869668');
    await page.fill('#inLon', '5.098666');
    await page.click('#sec-etat .chip[data-v="Existant"]');
    await page.selectOption('#sec-typo select', 'Seuil en rivière');
    await page.locator('#sec-typo select').nth(1).selectOption('Déversoir');
    await page.locator('#sec-usages input[data-usage="Pisciculture"]').check();
    await page.click('#sec-dfp .chip[data-v="Oui"]');
    await page.click('#sec-dfp .tog[data-pt="Prébarrage"][data-pp="Rive droite"]');
    // Photo 3000 × 2000 générée dans la page, passée par le vrai chemin de compression
    const photo = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 3000; cv.height = 2000;
      const g = cv.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 3000, 2000);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      await ajouterPhoto(cur, new File([blob], 'p.png', { type: 'image/png' })); touch(); await flush(); FORM.rerender();
      return { w: cur.photos[0].w, h: cur.photos[0].h, jpeg: cur.photos[0].data.startsWith('data:image/jpeg') };
    });
    assert.deepEqual(photo, { w: 1600, h: 1067, jpeg: true });
    await page.locator('#sec-photos input[data-leg="0"]').fill('Vue aval');
    await page.click('#btnBack');
    await page.waitForTimeout(300);   // écriture IndexedDB asynchrone

    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#ficheList li').length === 1);
    await page.locator('#ficheList li').first().click();
    const fi = await page.evaluate(() => JSON.parse(JSON.stringify(cur)));
    assert.equal(fi.nom, 'Seuil du Moulin'); assert.equal(fi.lat, '43.869668'); assert.equal(fi.etat, 'Existant');
    assert.equal(fi.typo_sous, 'Déversoir');
    assert.deepEqual(fi.usages, ['Activité aquacole', 'Pisciculture']);
    assert.deepEqual(fi.passes, { 'Prébarrage': ['Rive droite'] });
    assert.equal(fi.photos.length, 1); assert.equal(fi.photos[0].legende, 'Vue aval');
    assert.equal(await page.locator('#sec-photos img').count(), 1);

    // Export, suppression locale, réimport du fichier
    const txt = await page.evaluate(() => JSON.stringify(paquet(Store.list())));
    await page.evaluate(async () => { await Store.del(cur.id); cur = null; go('home'); });
    const t = await page.evaluate(async s => { const r = await importerTextes([s, s, '{"x":1}']); renderHome(); return r; }, txt);
    assert.deepEqual(t, { ajout: 1, maj: 0, ignore: 1, err: 1 });
    const back = await page.evaluate(() => JSON.parse(JSON.stringify(Store.list()[0])));
    assert.deepEqual(back, fi);

    // Fiche créée puis abandonnée : non conservée
    await page.click('#btnNew'); await page.click('#btnBack'); await page.waitForTimeout(300);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#scr-home.active'));
    assert.equal(await page.locator('#ficheList li').count(), 1);
    assert.deepEqual(page.errors.filter(m => !/\bL is not defined/.test(m)), []);
  });
});

test('ROE : téléchargement d’une zone (flux simulé), conservation hors ligne, création de fiche depuis un ROE', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/roe/index.html');
    let appels = 0;
    const sandre = u => u.hostname === 'services.sandre.eaufrance.fr';
    await page.route(sandre, r => {
      appels++;
      const u = new URL(r.request().url());
      if (u.searchParams.get('RESULTTYPE') === 'hits')
        return r.fulfill({ body: '<wfs:FeatureCollection numberMatched="2" numberReturned="0"/>', contentType: 'text/xml', headers: { 'Access-Control-Allow-Origin': '*' } });
      return r.fulfill({ body: JSON.stringify({ type: 'FeatureCollection', features: [entite('ROE53049'), entite('ROE53050', { NomPrincipalObstEcoul: 'Prise du canal' }, [5.131, 43.92])] }),
        contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.waitForFunction(() => document.querySelector('#scr-home.active'));
    await page.click('#btnCarte');
    const z = await page.evaluate(async () => { const z = await telechargerZone([43.8, 5, 43.95, 5.2]); return z && z.n; });
    assert.equal(z, 2); assert.equal(appels, 2);
    // Zone plus large : remplace la précédente
    await page.evaluate(() => telechargerZone([43.7, 4.9, 44, 5.3]));
    assert.match(await page.textContent('#gcStat'), /2 ROE en mémoire \(1 zone,/);

    // Hors ligne (flux coupé) : les ROE restent disponibles après rechargement
    await page.unroute(sandre);   // requêtes vers le flux de nouveau bloquées
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#scr-home.active'));
    await page.click('#btnCarte');
    await page.waitForFunction(() => /2 ROE en mémoire/.test(document.querySelector('#gcStat').textContent));
    const err = await page.evaluate(async () => { await telechargerZone([43, 3, 44, 4]); return document.querySelector('#toast').textContent; });
    assert.match(err, /Connexion requise/);

    // Fiche d'information puis création d'une fiche pré-remplie
    await page.evaluate(() => infoROE(roeEnMemoire(GC.data).find(r => r.c === 'ROE53049')));
    assert.match(await page.textContent('#shBody'), /Seuil en rivière \/ Déversoir/);
    await page.click('#shCreate');
    await page.waitForFunction(() => document.querySelector('#scr-fiche.active'));
    const fi = await page.evaluate(() => ({ roe: cur.roe_id, nom: cur.nom, sous: cur.typo_sous }));
    assert.deepEqual(fi, { roe: 'ROE53049', nom: 'Seuil VALDOR', sous: 'Déversoir' });
    // Retour sur la carte depuis la fiche, puis fiche existante proposée à l'ouverture
    await page.click('#btnVersCarte');
    await page.waitForFunction(() => document.querySelector('#scr-carte.active'));
    await page.evaluate(() => infoROE(roeEnMemoire(GC.data).find(r => r.c === 'ROE53049')));
    assert.equal(await page.locator('#shOpen').count(), 1);
    await page.click('#btnBack');
    await page.waitForFunction(() => document.querySelector('#scr-fiche.active'));
    assert.deepEqual(page.errors.filter(m => !/\bL is not defined/.test(m)), []);
  });
});
