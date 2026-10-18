import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, read } from './helpers.mjs';

// ---- Service worker racine
const ORIGIN = 'https://robinrgg.github.io';
const swCtx = vm.createContext({
  self: { location: new URL(ORIGIN + '/turbo-app/sw.js'), addEventListener() {} },
  importScripts() {}, URL, console,
});
vm.runInContext(read('sw.js') + '\n;this.strategyFor = strategyFor;', swCtx);
const strategy = u => swCtx.strategyFor(new URL(u));

test('SW : les API temps réel ne sont jamais servies depuis le cache', () => {
  for (const u of [
    'https://hubeau.eaufrance.fr/api/v2/hydrometrie/referentiel/stations',
    'https://api.open-meteo.com/v1/forecast?latitude=43&longitude=6',
    'https://geo.api.gouv.fr/communes?nom=Riez',
  ]) assert.equal(strategy(u), 'live', u);
});

test('SW : CDN en cache-first, fichiers du hub en network-first', () => {
  assert.equal(strategy('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'), 'cdn');
  assert.equal(strategy('https://fonts.gstatic.com/s/x.woff2'), 'cdn');
  assert.equal(strategy(ORIGIN + '/turbo-app/apps/carhyce/app.js'), 'local');
});

test('SW : toute API appelée par meteo-hydro est déclarée temps réel', () => {
  const html = read('apps/meteo-hydro/index.html');
  const hosts = new Set([...html.matchAll(/const \w+\s*=\s*'(https:\/\/[^']+)'/g)].map(m => new URL(m[1]).hostname));
  assert.ok(hosts.size >= 3);
  for (const h of hosts) assert.equal(strategy(`https://${h}/x`), 'live', h);
});

// ---- Registre et structure des apps
const appsCtx = vm.createContext({ self: {} });
vm.runInContext(read('apps.js'), appsCtx);
const APPS = JSON.parse(JSON.stringify(appsCtx.self.APPS));

test('registre : chaque app a son dossier, sa page et son icône', () => {
  assert.ok(APPS.length >= 6);
  for (const a of APPS) {
    assert.ok(existsSync(path.join(ROOT, 'apps', a.slug, 'index.html')), `apps/${a.slug}/index.html`);
    if (a.icone.startsWith('./')) assert.ok(existsSync(path.join(ROOT, a.icone)), a.icone);
    assert.equal(typeof a.offline, 'boolean', a.slug);
  }
  assert.equal(new Set(APPS.map(a => a.slug)).size, APPS.length, 'slugs uniques');
});

test('précache : precache-manifest.js est à jour (python build_sw_assets.py --check)', () => {
  execFileSync('python3', ['build_sw_assets.py', '--check'], { cwd: ROOT, stdio: 'pipe' });
});

test('précache : chaque fichier listé existe', () => {
  const ctx = vm.createContext({ self: {} });
  vm.runInContext(read('precache-manifest.js'), ctx);
  for (const u of ctx.self.PRECACHE) {
    if (u.startsWith('http') || u === './') continue;
    assert.ok(existsSync(path.join(ROOT, u)), u);
  }
});

// ---- Un seul service worker pour tout le hub
const appFiles = APPS.flatMap(a => readdirSync(path.join(ROOT, 'apps', a.slug))
  .filter(f => /\.(html|js)$/.test(f) && f !== 'sw.js').map(f => `apps/${a.slug}/${f}`));

test('aucune app n’enregistre son propre service worker', () => {
  for (const f of appFiles) {
    for (const m of read(f).matchAll(/serviceWorker\s*\.register\(\s*['"]([^'"]+)['"]/g)) {
      assert.equal(m[1], '../../sw.js', `${f} enregistre ${m[1]}`);
    }
  }
});

test('les SW de retrait ne touchent qu’à leurs propres caches, jamais aux données', () => {
  for (const [slug, prefix] of [['carhyce', 'carhyce-'], ['jaugeage', 'jg-']]) {
    const s = read(`apps/${slug}/sw.js`).replace(/\/\*[\s\S]*?\*\//g, '');   // sans les commentaires
    assert.match(s, /registration\.unregister\(\)/);
    assert.match(s, new RegExp(`startsWith\\('${prefix}'\\)`));
    assert.doesNotMatch(s, /localStorage|indexedDB|addEventListener\('fetch'/);
  }
});

test('aucun code n’efface les données de saisie des appareils', () => {
  for (const f of [...appFiles, 'index.html', 'sw.js', 'apps/carhyce/sw.js', 'apps/jaugeage/sw.js']) {
    assert.doesNotMatch(read(f), /localStorage\.clear\(|indexedDB\.deleteDatabase|Clear-Site-Data/, f);
  }
});
