// Graphiques vérifiés dans un vrai navigateur (Playwright, facultatif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';
import { hasBrowser, withBrowser } from './browser.mjs';

const skip = !hasBrowser && 'Playwright absent';

test('profil en long : l’amont plus haut est tracé plus haut, distances croissantes vers la droite', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/profil-long/index.html');
    const pts = await page.evaluate(() => {
      cur = newStation();
      cur.troncons = [10, 20, 15].map((d, i) => ({ ...newTroncon(), distance_m: d,
        aval: { fh: null, fm: 150, fb: null }, amont: { fh: null, fm: 150 - 10 * (i + 1), fb: null } }));
      renderProfil();
      return [...document.querySelectorAll('#profil circle')].map(c => [+c.getAttribute('cx'), +c.getAttribute('cy')]);
    });
    assert.equal(pts.length, 4);
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i][0] > pts[i - 1][0], 'x croissant');
      assert.ok(pts[i][1] < pts[i - 1][1], 'monte vers l’amont (y écran décroissant)');
    }
    assert.deepEqual(page.errors, []);
  });
});

test('CARHYCE profil en travers : plus profond = plus bas, hors d’eau au-dessus de la ligne d’eau', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/carhyce/index.html');
    const r = await page.evaluate(() => {
      const op = DB.newOperation();
      op.transects[0].points = [
        { distance_m: 0, profondeur_cm: -20 }, { distance_m: 1, profondeur_cm: 10 },
        { distance_m: 3, profondeur_cm: 50 }, { distance_m: 2, profondeur_cm: 30 }, { distance_m: 4, profondeur_cm: 0 }];
      App.state.op = op; App.state.currentTransect = 0;
      const root = document.createElement('div'); root.id = 'profile-chart'; document.body.appendChild(root);
      App.refreshProfileChart();
      const eau = +root.querySelector('.line-eau-niveau').getAttribute('y1');
      const pts = [...root.querySelectorAll('circle')].map(c => ({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), cls: c.getAttribute('class') }));
      return { eau, pts };
    });
    const [p0, p1, p2, p3, p4] = r.pts;              // triés par distance : 0, 1, 2, 3, 4 m
    assert.ok(p0.x < p1.x && p1.x < p2.x && p2.x < p3.x && p3.x < p4.x, 'tri par distance');
    assert.ok(p0.y < r.eau && p0.cls === 'pt-air', 'hors d’eau au-dessus');
    assert.ok(p1.y > r.eau && p2.y > p1.y && p3.y > p2.y, 'profondeurs croissantes plus bas');
    assert.ok(Math.abs(p4.y - r.eau) < 1e-6, 'profondeur 0 sur la ligne d’eau');
    assert.deepEqual(page.errors, []);
  });
});

// Hydro-météo : étiquettes Module / Q25 / QMNA5 sur 300 combinaisons aléatoires et 2 largeurs d'écran
test('hydro-météo : les étiquettes des débits caractéristiques ne se chevauchent jamais et restent dans le graphique', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/meteo-hydro/index.html', { cdn: true });
    const hasChart = await page.evaluate(() => typeof Chart !== 'undefined');
    if (!hasChart && process.env.CI) assert.fail('Chart.js non chargé');
    if (!hasChart) return;   // CDN injoignable hors CI : rien à vérifier
    for (const width of [380, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      const fautes = await page.evaluate(async () => {
        let seed = 7; const r = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
        const out = [];
        const wrap = document.createElement('div'); wrap.className = 'chart-wrap'; document.body.prepend(wrap);
        for (let k = 0; k < 150; k++) {
          wrap.innerHTML = '<canvas id="tc"></canvas>';
          const base = 50 + r() * 5000;                         // L/s
          const q = Array.from({ length: 20 }, (_, i) => ({ date_obs_elab: `2026-09-${String(i + 1).padStart(2, '0')}`, resultat_obs_elab: base * (0.5 + r()) }));
          const close = r() < 0.6, m = base / 1000;              // 60 % de cas avec valeurs très proches
          const vals = close ? [m * (1 + r() * 0.1), m * (1 - r() * 0.1), m * (1 + (r() - 0.5) * 0.1)] : [m * (0.2 + r() * 3), m * r(), m * r() * 0.5];
          const [mod, q5, q25] = vals.map(v => (r() < 0.1 ? null : v));
          buildChart('tc', q, mod, q5, q25, null);
          const c = Chart.getChart('tc');
          c.stop(); c.update('none');                              // positions finales, sans animation
          const st = Chart.registry.getPlugin('annotation')._getState(c);
          const labels = st.elements.map(e => ({ id: e.options.id, l: e.elements[0], ly: e.y })).filter(o => o.l);
          const area = c.chartArea;
          if (labels.length !== [mod, q5, q25].filter(v => v != null).length && mod != null && q5 != null && q25 != null && labels.length < 2) out.push(`#${k} étiquettes manquantes`);
          for (let i = 0; i < labels.length; i++) {
            const a = labels[i].l;
            if (a.y < area.top - 1 || a.y2 > area.bottom + 1) out.push(`#${k} ${labels[i].id} hors zone`);
            for (let j = i + 1; j < labels.length; j++) {
              const b = labels[j].l;
              if (a.x < b.x2 && b.x < a.x2 && a.y < b.y2 && b.y < a.y2) out.push(`#${k} ${labels[i].id}/${labels[j].id} se chevauchent`);
            }
          }
          c.destroy();
        }
        return out;
      });
      assert.deepEqual(fautes, [], `largeur ${width}px`);
    }
    assert.deepEqual(page.errors, []);
  });
});

test('CARHYCE pente : profil en long sous les calculs, même tracé que l’app Profil en long', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/carhyce/index.html');
    const r = await page.evaluate(() => {
      const op = DB.newOperation();
      op.pente.troncons = [10, 20, 15].map((d, i) => ({ limite_aval: '', limite_amont: '', distance_m: d,
        aval: { fh: null, fm: 150, fb: null }, amont: { fh: null, fm: 150 - 10 * (i + 1), fb: null } }));
      App.state.op = op; App.scheduleSave = () => {};
      App.renderPente();
      const wrap = document.getElementById('pente-calc');
      const chart = document.getElementById('pente-chart');
      return { apresCalculs: wrap.lastElementChild === chart && !!wrap.querySelector('.field'),
        pts: [...chart.querySelectorAll('circle')].map(c => [+c.getAttribute('cx'), +c.getAttribute('cy')]) };
    });
    assert.ok(r.apresCalculs, 'graphique en bas, après les calculs');
    assert.equal(r.pts.length, 4);
    for (let i = 1; i < r.pts.length; i++) {
      assert.ok(r.pts[i][0] > r.pts[i - 1][0], 'x croissant');
      assert.ok(r.pts[i][1] < r.pts[i - 1][1], 'monte vers l’amont');
    }
    assert.deepEqual(page.errors, []);
  });
});

test('profil en long (3 apps) : axes tracés, abscisses graduées en distance, titres des deux axes', { skip }, async t => {
  const T = [[12, 150, 144], [18, 144, 133], [9, 133, 129], [15, 129, 121]];   // Σ distances = 54 m
  const cas = [
    ['Profil en long', '/apps/profil-long/index.html', '#profil', T => {
      cur = newStation(); cur.troncons = T.map(([d, a, m]) => ({ ...newTroncon(), distance_m: d, aval: { fh: null, fm: a, fb: null }, amont: { fh: null, fm: m, fb: null } }));
      renderProfil(); }],
    ['CARHYCE', '/apps/carhyce/index.html', '#pente-chart svg', T => {
      const op = DB.newOperation(); op.pente.troncons = T.map(([d, a, m]) => ({ limite_aval: '', limite_amont: '', distance_m: d, aval: { fh: null, fm: a, fb: null }, amont: { fh: null, fm: m, fb: null } }));
      App.state.op = op; App.scheduleSave = () => {}; App.renderPente(); }],
    ['Estimhab', '/apps/habitat-stat/index.html', '#leChart', T => {
      cur = newStation(); cur.station.troncons = T.map(([d, a, m]) => ({ ...newTronconLE(), distance_m: d, aval: { fh: null, fm: a, fb: null }, amont: { fh: null, fm: m, fb: null } }));
      go('ligne'); }]];
  await withBrowser(async ({ open }) => {
    for (const [nom, url, sel, remplir] of cas) await t.test(nom, async () => {
      const page = await open(url);
      await page.evaluate(`(${remplir})(${JSON.stringify(T)})`);
      const r = await page.$eval(sel, svg => ({ textes: [...svg.querySelectorAll('text')].map(e => e.textContent),
        axes: [...svg.querySelectorAll('line')].filter(l => l.getAttribute('stroke-width') === '1.2').length }));
      assert.ok(r.textes.includes("Distance cumulée depuis l'aval (m)"), 'titre des abscisses');
      assert.ok(r.textes.includes('Δh cumulé (m)'), 'titre des ordonnées');
      assert.equal(r.axes, 2, 'axes x et y tracés');
      for (const g of ['0', '10', '20', '30', '40', '50']) assert.ok(r.textes.includes(g), `graduation ${g} m`);
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  });
});

test('Hydro-Météo : onglet Débit instantané (stations du bilan, période, lecture à une heure, graphique)', { skip }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/meteo-hydro/index.html', { cdn: true });
    await page.evaluate(() => {
      const now = Date.now(), pas = 5 * 60e3;
      window.hubGet = async url => {                     // 3 jours simulés, 1 m³/s puis 2 m³/s les dernières 24 h
        const debut = Date.parse(decodeURIComponent(url.match(/date_debut_obs=([^&]+)/)[1]));
        const data = [];
        for (let t = Math.ceil(debut / pas) * pas; t <= now - 30 * 60e3; t += pas) data.push({ date_obs: new Date(t).toISOString(), resultat_obs: t > now - 24 * 3600e3 ? 2000 : 1000 });
        return { data };
      };
      state.selected = [{ code_station: 'X0000001', libelle_station: 'Station test', libelle_cours_eau: 'Rivière', libelle_commune: '', lat: 44, lon: 4 }];
      updateCartUI();
    });
    await page.click('#nav-qi');
    await page.waitForSelector('#qi_chart_0');
    // recherche et sélection disponibles directement dans l'onglet (mêmes cartes que Bilan terrain)
    assert.equal(await page.evaluate(() => !!document.querySelector('#page-qi #card-search') && !!document.querySelector('#page-qi #card-cart')), true);
    assert.match(await page.textContent('#btnGenerate'), /débits instantanés/);
    const txt = await page.textContent('#qi-list');
    assert.doesNotMatch(txt, /Export CSV|Module|QMNA5|Q25/);
    assert.equal(await page.evaluate(() => Object.keys(Chart.getChart('qi_chart_0').options.plugins.annotation.annotations).filter(k => /^(min|max)$/.test(k)).length), 2, 'min et max marqués');
    assert.match(txt, /Station test/);
    assert.match(txt, /Dernier QI/);
    assert.match(txt, /\+1\.00\s*Variation sur 24 h/);
    assert.equal(await page.evaluate(() => !!Chart.getChart('qi_chart_0')), true);
    // lecture à une heure précise (il y a 2 jours) → 1 m³/s
    await page.evaluate(() => { const d = new Date(Date.now() - 2 * 864e5 - new Date().getTimezoneOffset() * 60000);
      const at = document.getElementById('qi-at'); at.value = d.toISOString().slice(0, 16); at.dispatchEvent(new Event('change')); });
    assert.match(await page.textContent('.qi-at-res'), /1\.00 m³\/s/);
    // passage sur 30 jours : rechargement
    await page.click('#qi-periods [data-days="30"]');
    await page.waitForFunction(() => qiState.days === 30 && !document.getElementById('qi-loader').classList.contains('show'));
    assert.match(await page.textContent('#qi-list'), /30 jours/);
    // retrait d'une station depuis l'onglet : la liste suit
    await page.click('#page-qi .btn-rm');
    await page.waitForFunction(() => !document.querySelector('#qi-list .card'));
    // retour au bilan : les cartes y reviennent
    await page.click('#nav-bilan');
    assert.equal(await page.evaluate(() => !!document.querySelector('#page-bilan #card-search')), true);
    assert.match(await page.textContent('#btnGenerate'), /Générer le bilan/);
    assert.deepEqual(page.errors, []);
  });
});
