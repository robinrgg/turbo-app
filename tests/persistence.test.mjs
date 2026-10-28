// Bout en bout dans la vraie interface (Playwright, facultatif) : saisie, rechargement
// de la page, puis données ET résultats identiques. Vérifie aussi l'affichage au démarrage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBrowser, withBrowser } from './browser.mjs';

const skip = !hasBrowser && 'Playwright absent';

test('profil en long : saisie au clavier → rechargement → données et pente conservées', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/profil-long/index.html');
    await page.click('#btnNew');
    const card = page.locator('#troncons .troncon').first();
    await card.locator('.field', { hasText: 'Distance (m)' }).locator('input').fill('12,5');
    await card.locator(".field", { hasText: "Hauteur d'eau (cm)" }).locator('input').fill('18');
    const rows = card.locator('.visee-row');
    for (const [row, vals] of [[0, ['140', '150', '160']], [1, ['120', '125', '130']]]) {
      const inputs = rows.nth(row).locator('input');
      for (let i = 0; i < 3; i++) await inputs.nth(i).fill(vals[i]);
    }
    const avant = await page.textContent('#stats');
    assert.match(avant, /20(\.|,)0/, 'pente = 0,25 m / 12,5 m = 20 ‰');
    await page.reload();
    await page.locator('#stList li').first().click();
    assert.equal(await page.textContent('#stats'), avant);
    const card2 = page.locator('#troncons .troncon').first();
    assert.equal(await card2.locator('.field', { hasText: 'Distance (m)' }).locator('input').inputValue(), '12.5');
    assert.equal(await card2.locator(".field", { hasText: "Hauteur d'eau (cm)" }).locator('input').inputValue(), '18');
    assert.deepEqual(page.errors, []);
  });
});

test('jaugeage : saisie → rechargement → verticales et débit conservés, résultats affichés au démarrage', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/jaugeage/index.html');
    await page.evaluate(() => { state.verticales = []; saveState(); });
    await page.reload();
    const Q1 = await page.evaluate(async () => {
      const ajout = (x, d, vs) => { addVerticale(); const v = state.verticales[state.verticales.length - 1];
        updVert(v.id, 'abscisse', String(x)); updVert(v.id, 'profondeur', String(d)); vs.forEach((val, i) => updPoint(v.id, i, 'v', String(val))); };
      ajout(0, 0, []); ajout(1, 0.5, [0.4, 0.5, 0.3]); ajout(2, 0.6, [0.5, 0.6, 0.4]); ajout(3, 0.4, [0.3, 0.4, 0.2]); ajout(4, 0, []);
      await new Promise(r => setTimeout(r, 700));             // sauvegarde différée (400 ms)
      return document.getElementById('r_Q').textContent;
    });
    assert.match(Q1, /^\d+[.,]\d{3}/);
    // calcul à la main : méthode 3 points (v0,2 + 2·v0,4 + v0,8)/4, largeurs d'influence 1 m
    //   0,425 × 0,5 + 0,525 × 0,6 + 0,325 × 0,4 = 0,6575 m³/s ; bords de profondeur nulle → 0
    assert.ok(Math.abs(parseFloat(Q1.replace(',', '.')) - 0.6575) <= 0.0006, Q1);
    await page.reload();
    assert.equal(await page.textContent('#r_Q'), Q1, 'débit identique après rechargement');
    assert.equal(await page.evaluate(() => state.verticales.length), 5);
    assert.deepEqual(page.errors, []);
  });
});

test('Estimhab / Stathab : station saisie → rechargement → données et synthèse conservées', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/habitat-stat/index.html');
    const avant = await page.evaluate(() => {
      const st = newStation(); st.station.code = 'TEST01';
      Object.assign(st.camp1, { debit: '0.4', lm: '7', transects: [{ largeur: '5', points: [{ h: '10', s: '' }, { h: '30', s: '' }], collapsed: false }] });
      Store.put(st);
      return JSON.stringify(computeCamp(st.camp1));
    });
    await page.reload();
    const apres = await page.evaluate(() => {
      const st = Store.list().find(s => s.station.code === 'TEST01');
      return st && JSON.stringify(computeCamp(st.camp1));
    });
    assert.equal(apres, avant);
    assert.match(await page.textContent('body'), /TEST01/, 'station listée à l’accueil');
    assert.deepEqual(page.errors, []);
  });
});

test('sauvegarde locale corrompue : aucune app ne plante au démarrage', { skip }, async t => {
  const cas = [['/apps/profil-long/index.html', 'profil-long.v2'], ['/apps/jaugeage/index.html', 'jaugeage_current_v2'],
    ['/apps/habitat-stat/index.html', 'habitat-stat.v2'], ['/apps/checklist/index.html', 'cl_checks_v2']];
  await withBrowser(async ({ open }) => {
    for (const [p, key] of cas) await t.test(p, async () => {
      const page = await open(p);
      await page.evaluate(k => localStorage.setItem(k, '{corrompu'), key);
      page.errors.length = 0;
      await page.reload(); await page.waitForTimeout(300);
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  });
});

test('jaugeage : export JSON → import → même débit et mêmes verticales', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/jaugeage/index.html');
    const r = await page.evaluate(async () => {
      state.verticales = [newVerticale(0, true), { ...newVerticale(1.2), profondeur: '0.55', points: [{ z_rel: 0.2, v: '0.41' }, { z_rel: 0.8, v: '0.30' }] },
        { ...newVerticale(2.5), profondeur: '0.7', isBathy: true, points: [] },
        { ...newVerticale(3.9), profondeur: '0.62', points: [{ z_rel: 0.4, v: '0.52' }] }, newVerticale(5.1, true)];
      renderAll();
      const Q0 = computeAll().Q;
      let fichier; window.download = (content) => { fichier = content; };
      exportJSON();
      state.verticales = []; renderAll();
      const file = new File([fichier], 'j.json', { type: 'application/json' });
      importJSON({ target: { files: [file], value: '' } });
      await new Promise(res => setTimeout(res, 300));
      return { Q0, Q1: computeAll().Q, n: state.verticales.length, bathy: state.verticales.filter(v => v.isBathy).length };
    });
    assert.ok(r.Q0 > 0);
    assert.equal(r.Q1, r.Q0);
    assert.equal(r.n, 5); assert.equal(r.bathy, 1);
    assert.deepEqual(page.errors, []);
  });
});

test('jaugeage : une verticale ajoutée a une distance au bord vide, puis saisie libre', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/jaugeage/index.html');
    const r = await page.evaluate(() => {
      addVerticale(); updVert(state.verticales[0].id, 'abscisse', '3.2');
      addVerticale();
      return { x: state.verticales.map(v => v.abscisse), champ: document.querySelector('.vert-detail input[oninput*="abscisse"], input[oninput*="abscisse"]')?.value };
    });
    assert.deepEqual(r.x, ['3.2', ''], 'aucune distance proposée automatiquement');
    assert.equal(r.champ, '', 'champ de saisie vide');
    assert.deepEqual(page.errors, []);
  });
});

test('Estimhab / Stathab : date et heure de campagne remplies à la saisie du débit, sans écraser une heure existante', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/habitat-stat/index.html');
    await page.evaluate(() => { cur = newStation(); Store.put(cur); go('station'); go('camp1'); });
    assert.equal(await page.inputValue('#scr-camp1 [data-f="heure"]'), '');
    assert.equal(await page.inputValue('#scr-camp1 [data-f="date"]'), '', 'date vide à la création');
    await page.evaluate(() => { cur.camp1.date = '2026-01-02'; go('camp1'); });   // ancienne date par défaut
    await page.fill('#scr-camp1 [data-f="debit"]', '0,42');
    assert.equal(await page.inputValue('#scr-camp1 [data-f="date"]'), await page.evaluate(() => todayISO()), 'date du jour de la mesure');
    const h = await page.inputValue('#scr-camp1 [data-f="heure"]');
    assert.match(h, /^\d\d:\d\d$/);
    assert.equal(await page.evaluate(() => cur.camp1.heure), h);
    await page.fill('#scr-camp1 [data-f="heure"]', '09:15');
    await page.fill('#scr-camp1 [data-f="debit"]', '0,43');
    assert.equal(await page.evaluate(() => cur.camp1.heure), '09:15', 'heure saisie conservée');
    await page.fill('#scr-camp1 [data-f="date"]', '2026-10-01');
    await page.fill('#scr-camp1 [data-f="debit"]', '0,44');
    assert.equal(await page.evaluate(() => cur.camp1.date), '2026-10-01', 'date corrigée conservée');
    assert.deepEqual(page.errors, []);
  });
});
