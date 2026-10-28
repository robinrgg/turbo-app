// Calculs de CARHYCE exécutés dans la vraie page (Playwright, facultatif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';
import { hasBrowser, withBrowser } from './browser.mjs';

const skip = !hasBrowser && 'Playwright absent';
const ref = JSON.parse(read('tests/fixtures/profil_long_reference.json'));
const num = s => parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(',', '.'));

test('CARHYCE : calculs de la page (granulométrie, pente, peau, colmatage, cohérence, export)', { skip }, async t => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/carhyce/index.html', { cdn: true });
    const stats = sel => page.$$eval(sel + ' .stat', els => Object.fromEntries(els.map(e => [e.querySelector('.label').textContent, e.querySelector('.value').textContent])));
    const calc = sel => page.$$eval(sel + ' .field', els => Object.fromEntries(els.map(e => [e.querySelector('label').textContent, e.querySelector('.calc-value')?.textContent])));
    await page.evaluate(() => { App.state.op = DB.newOperation(); App.scheduleSave = () => {}; });

    await t.test('granulométrie : D16 / D50 / D84 par interpolation linéaire des rangs', async () => {
      await page.evaluate(() => { App.state.op.granulometrie.mesures_mm = Array.from({ length: 100 }, (_, i) => 100 - i); App.renderGranulo(); });
      const s = await stats('#granulo-stats');
      assert.equal(s['N saisi'], '100 / 100');
      assert.equal(num(s.D16), 16.8);    // rang (n−1)·0,16 = 15,84 → 16 + 0,84
      assert.equal(num(s['D50 (médian)']), 50.5);
      assert.equal(num(s.D84), 84.2);
      assert.equal(num(s['D84 / D16']), +(84.16 / 16.84).toFixed(2));
      assert.equal(num(s.Min), 1); assert.equal(num(s.Max), 100);
      // valeurs manquantes ignorées ; médiane d'un nombre impair de valeurs = valeur centrale
      await page.evaluate(() => { App.state.op.granulometrie.mesures_mm = [5, null, 1, 9, null, 3, 7]; App.refreshGranuloStats(); });
      const s2 = await stats('#granulo-stats');
      assert.equal(s2['N saisi'], '5 / 100'); assert.equal(num(s2['D50 (médian)']), 5);
    });

    await t.test('pente : identique à l’app Profil en long sur le même relevé (deux codes indépendants)', async () => {
      const st = await page.evaluate(troncons => {
        App.state.op.pente.troncons = troncons.map(t => ({ limite_aval: '', limite_amont: '', distance_m: t.distance_m, aval: t.aval, amont: t.amont }));
        App.renderPente();
        return App.state.op.station;
      }, ref.troncons);
      assert.equal(st.pente_estimee_pourmille, ref.synthese.pente_estimee_pourmille);
      assert.equal(st.pente_calculee_pourmille, ref.synthese.pente_regression_pourmille);
      const c = await calc('#pente-calc');
      assert.equal(num(c['ΔH (m)']), +ref.synthese.delta_h_m.toFixed(2));
      assert.equal(num(c['Σ distances (m)']), +ref.synthese.sigma_distance_m.toFixed(2));
    });

    await t.test('peau : moyenne des seules profondeurs > 0', async () => {
      const txt = await page.evaluate(() => {
        const tr = App.state.op.transects[0];
        tr.points = [{ profondeur_cm: -10 }, { profondeur_cm: 0 }, { profondeur_cm: 20 }, { profondeur_cm: 40 }, { profondeur_cm: null }];
        App.state.currentTransect = 0;
        const el = document.createElement('div'); el.id = 'peau-calc'; document.body.appendChild(el);
        App.refreshTransectCalc();
        return el.querySelector('.calc-value').textContent;
      });
      assert.equal(num(txt), 0.3);
    });

    await t.test('colmatage : moyenne par radier, moyenne globale, écart-type, CV', async () => {
      await page.evaluate(() => {
        const c = App.state.op.colmatage;
        [2, 4, 4, 4].forEach((v, i) => { c.radiers[0].batonnets[i].profondeur_oxy_cm = v; });
        [5, 5, 7, 9].forEach((v, i) => { c.radiers[1].batonnets[i].profondeur_oxy_cm = v; });
        App.renderColmatage ? App.renderColmatage() : null;
        if (!document.getElementById('colmatage-synth')) { const d = document.createElement('div'); d.id = 'colmatage-synth'; document.body.appendChild(d); }
        App.refreshColmatageStats();
      });
      const c = await calc('#colmatage-synth');
      assert.equal(num(c['Moyenne globale (cm)']), 5);      // (2+4+4+4+5+5+7+9)/8
      assert.equal(num(c['Écart-type (cm)']), 2);           // écart-type de population
      assert.equal(num(c['Coef. de variation']), 40);
    });

    await t.test('critères « transect complet » identiques à la saisie et à la fusion', async () => {
      const diff = await page.evaluate(() => {
        let seed = 3; const r = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
        const out = [];
        for (let k = 0; k < 300; k++) {
          const tr = JSON.parse(JSON.stringify(DB.newOperation().transects[0]));
          if (r() < 0.8) tr.lpb_m = 5; if (r() < 0.8) tr.lm_m = 4; if (r() < 0.8) tr.hpb_m = 1;
          tr.points = Array.from({ length: Math.floor(r() * 12) }, () => ({}));
          if (r() < 0.8) tr.facies_affine = 'Radier';
          if (r() < 0.8) tr.berge_rg.materiaux = 'Terre'; if (r() < 0.8) tr.berge_rd.materiaux = 'Blocs';
          if (App.isTransectComplete(tr) !== Fusion.estComplet(tr)) out.push(k);
        }
        return out;
      });
      assert.deepEqual(diff, []);
    });

    await t.test('export Excel : données relues identiques, transects supprimés exclus', async (tt) => {
      const hasX = await page.evaluate(() => typeof XLSX !== 'undefined');
      if (!hasX) { if (process.env.CI) assert.fail('SheetJS non chargé'); return tt.skip('SheetJS indisponible'); }
      const r = await page.evaluate(async () => {
        const op = App.state.op;
        op.station.code = 'X0001'; op.transects[1].modification.type = 'Suppression';
        op.transects[0].points = [{ distance_m: 0, profondeur_cm: 0 }, { distance_m: 1.5, profondeur_cm: 32 }];
        let blob; Exporter.download = b => { blob = b; }; App.toast = () => {};
        Exporter.toXLSX(op);
        const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
        const rows = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 });
        return { sheets: wb.SheetNames, station: rows('Station'), gran: rows('Granulométrie'), pente: rows('Pente'), t1: rows('T1'),
                 nTroncons: op.pente.troncons.length, mes: op.granulometrie.mesures_mm };
      });
      assert.ok(!r.sheets.includes('T2'), 'T2 supprimé non exporté');
      assert.ok(r.sheets.includes('T1') && r.sheets.includes('T15'));
      assert.equal(r.station.find(l => l[0] === 'Code station')[1], 'X0001');
      assert.equal(r.station.find(l => l[0] === 'Pente calculée (‰)')[1], ref.synthese.pente_regression_pourmille);
      assert.equal(r.pente.length - 3, r.nTroncons);
      assert.equal(r.pente[3][10], ref.troncons[0].dh_m);
      const vide = v => (v === '' || v === undefined ? null : v);
      for (let i = 0; i < 100; i++) assert.equal(vide(r.gran[4 + i][1]), r.mes[i] ?? null, `mesure ${i + 1}`);
      const pts = r.t1.slice(r.t1.findIndex(l => l[0] === 'N°') + 1, r.t1.findIndex(l => l[0] === 'N°') + 3);
      assert.deepEqual(pts.map(l => [l[1], l[2]]), [[0, 0], [1.5, 32]]);
    });

    assert.deepEqual(page.errors, []);
  });
});

// À l'ouverture de chaque écran avec des données déjà saisies, les valeurs calculées
// doivent s'afficher immédiatement (sans avoir à modifier un champ).
test('CARHYCE : chaque écran affiche ses calculs dès l’ouverture', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/carhyce/index.html');
    const r = await page.evaluate(troncons => {
      const op = DB.newOperation();
      op.station.lpb_ev_mesures = [7, 8, 9]; op.station.lm_ev_mesures = [6.3, 7, 7.7];
      op.granulometrie.mesures_mm = [12, 30, 45, 80];
      op.pente.troncons = troncons.slice(0, 3).map(t => ({ limite_aval: '', limite_amont: '', distance_m: t.distance_m, aval: t.aval, amont: t.amont }));
      op.colmatage.radiers[0].batonnets[0].profondeur_oxy_cm = 4;
      op.transects[0].points = [{ distance_m: 0, profondeur_cm: 0 }, { distance_m: 1, profondeur_cm: 30 }, { distance_m: 2, profondeur_cm: 10 }];
      App.state.op = op; App.scheduleSave = () => {};
      const txt = sel => (document.querySelector(sel) || {}).textContent || '';
      const out = {};
      App.renderStation(); out.station = [...document.querySelectorAll('.calc-value')].map(e => e.textContent).join(' | ');
      App.renderGranulo(); out.granulo = txt('#granulo-stats');
      App.renderPente(); out.pente = txt('#pente-calc');
      App.renderColmatage(); out.colmatage = txt('#colmatage-synth') + ' ' + txt('[data-radier-mean="A"]');
      App.openTransectEdit(0); out.peau = txt('#peau-calc'); out.profil = !!document.querySelector('#profile-chart svg');
      return out;
    }, ref.troncons);
    assert.match(r.station, /112\.00 m/, 'Lpb moyen × 14 = 8 × 14');
    assert.match(r.station, /1\.00 m/, 'Lm moyen / 7 = 7 / 7');
    assert.match(r.granulo, /D50.*37\.5 mm/);
    assert.match(r.pente, /Pente estimée.*\d/);
    assert.match(r.colmatage, /4\.00/);
    assert.match(r.peau, /0\.20 m/);
    assert.equal(r.profil, true);
    assert.deepEqual(page.errors, []);
  });
});

// VA (végétation aquatique) n'est plus un habitat de berge : absent des cases à cocher et purgé
// des fiches existantes à l'ouverture ; il reste un substrat additionnel valide.
test('CARHYCE : habitat de berge VA retiré et purgé des fiches existantes', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/carhyce/index.html');
    const r = await page.evaluate(async () => {
      const op = DB.newOperation();
      op.transects[0].berge_rg.habitats = ['SB', 'VA', 'VS'];
      op.transects[1].berge_rd.habitats = ['VA'];
      op.station.habitats_non_min_marginaux.liste = ['VA'];
      await DB.put(op);
      await App.openOperation(op.id);
      const relu = await DB.get(op.id);
      App.openTransectEdit(0);
      const cases = [...document.querySelectorAll('.checkbox-group input')].map(c => c.value);
      return { rg: relu.transects[0].berge_rg.habitats, rd: relu.transects[1].berge_rd.habitats,
        substrats: relu.station.habitats_non_min_marginaux.liste, cases };
    });
    assert.deepEqual(r.rg, ['SB', 'VS']);
    assert.deepEqual(r.rd, []);
    assert.deepEqual(r.substrats, ['VA'], 'VA reste un substrat additionnel');
    assert.deepEqual(r.cases, ['SB', 'CR', 'DL', 'BR', 'VS', 'SB', 'CR', 'DL', 'BR', 'VS']);
  });
});

test('CARHYCE pente : la visée aval reprend la visée amont du tronçon précédent (comme Profil en long)', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/carhyce/index.html');
    const r = await page.evaluate(() => {
      const op = DB.newOperation();
      const vide = () => ({ fh: null, fm: null, fb: null });
      op.pente.troncons = [
        { limite_aval: '', limite_amont: '', distance_m: 10, aval: { fh: 160, fm: 150, fb: 140 }, amont: { fh: 131, fm: 121, fb: 111 } },
        { limite_aval: '', limite_amont: '', distance_m: 12, aval: vide(), amont: vide() },
        { limite_aval: '', limite_amont: '', distance_m: 8, aval: { fh: 1, fm: 2, fb: 3 }, amont: vide() }];
      App.state.op = op; App.scheduleSave = () => {}; App.toast = () => {};
      App.renderPente();
      const boutons = () => [...document.querySelectorAll('#troncons-list .troncon-card')].map(c => c.querySelector('button.secondary-btn'));
      const nb = boutons().filter(Boolean).length;
      boutons()[1].click();                                  // tronçon 2 : copie directe
      window.confirm = () => false; boutons()[2].click();    // tronçon 3 : refus d'écraser
      const t3refus = { ...op.pente.troncons[2].aval };
      return { nb, premier: boutons()[0], t2: op.pente.troncons[1].aval, t3refus };
    });
    assert.equal(r.nb, 2, 'pas de bouton sur le premier tronçon');
    assert.equal(r.premier, null);
    assert.deepEqual(r.t2, { fh: 131, fm: 121, fb: 111 });
    assert.deepEqual(r.t3refus, { fh: 1, fm: 2, fb: 3 }, 'visée existante conservée si refus');
  });
});
