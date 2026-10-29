import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineScripts, loadFunctions } from './helpers.mjs';

const src = inlineScripts('apps/meteo-hydro/index.html');
const ls2m3 = v => v != null ? v / 1000 : null;

test('module : moyenne des débits mensuels (L/s → m³/s)', () => {
  const { calcModule } = loadFunctions(src, ['calcModule'], { ls2m3 });
  assert.equal(calcModule([{ resultat_obs_elab: 1000 }, { resultat_obs_elab: 3000 }, { resultat_obs_elab: null }]), 2);
  assert.equal(calcModule([]), null);
});

test('QMNA5 : quantile 20 % des minimums mensuels par année hydrologique', () => {
  const { calcQMNA5 } = loadFunctions(src, ['calcQMNA5'], { ls2m3 });
  const qmm = [];
  // 5 années hydrologiques complètes (oct. N-1 → sept. N), minimum annuel = 100·k L/s
  for (let k = 1; k <= 5; k++) {
    for (let i = 0; i < 12; i++) {
      const m = (9 + i) % 12 + 1, y = 2014 + k + (m >= 10 ? -1 : 0);
      qmm.push({ date_obs_elab: `${y}-${String(m).padStart(2, '0')}-01`, resultat_obs_elab: i === 9 ? 100 * k : 5000 });
    }
  }
  // Comportement actuel : indice floor(n × 0,2) des minimums triés → sur 5 ans, le 2e plus petit.
  // (Valeur de secours uniquement : les valeurs officielles du CSV sont prioritaires.)
  assert.equal(calcQMNA5(qmm), 0.2);
  assert.equal(calcQMNA5(qmm.slice(0, 48)), null);  // 4 ans seulement → non calculable
});

test('Q25 : quantile 25 % des débits journaliers', () => {
  const { calcQ25 } = loadFunctions(src, ['calcQ25'], { ls2m3 });
  const qmj = Array.from({ length: 100 }, (_, i) => ({ resultat_obs_elab: (i + 1) * 10 }));
  assert.equal(calcQ25(qmj), 0.26);
  assert.equal(calcQ25(qmj.slice(0, 5)), null);
});

// ---- Relances réseau (fetchRetry / hubGet)
function loadNet(responses, { onLine = true } = {}) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { status: r.status, headers: { get: h => (r.headers || {})[h] || null }, json: async () => r.body ?? {} };
  };
  const ctx = loadFunctions(src, ['fetchRetry', 'hubGet', 'get'],
    { fetch, URL, navigator: { onLine }, sleep: async () => {},
      RETRY_STATUS: [429, 502, 503, 504], RETRY_DELAYS_MS: [1500, 4000] });
  return { ctx, calls };
}

test('Hub’eau : un 503 passager est relancé puis réussit', async () => {
  const { ctx, calls } = loadNet([{ status: 503 }, { status: 206, body: { data: [1] } }]);
  const d = await ctx.hubGet('https://hubeau.eaufrance.fr/x');
  assert.equal(d.data[0], 1);
  assert.equal(calls.length, 2);
});

test('Hub’eau : 503 persistant → message « serveur surchargé » après 3 essais', async () => {
  const { ctx, calls } = loadNet([{ status: 503 }, { status: 503 }, { status: 503 }]);
  await assert.rejects(ctx.hubGet('https://hubeau.eaufrance.fr/x'), /Hub'eau indisponible \(HTTP 503\).*surchargé/);
  assert.equal(calls.length, 3);
});

test('hors ligne (réponse du service worker) → « Pas de connexion réseau »', async () => {
  const off = { status: 503, headers: { 'X-Turbo-Offline': '1' } };
  const { ctx } = loadNet([off, off, off]);
  await assert.rejects(ctx.hubGet('https://hubeau.eaufrance.fr/x'), /Pas de connexion réseau - Hub'eau injoignable/);
});

test('appareil hors ligne : échec immédiat, sans relance', async () => {
  const { ctx, calls } = loadNet([new TypeError('Failed to fetch')], { onLine: false });
  await assert.rejects(ctx.get('https://api.open-meteo.com/v1/forecast'), /Pas de connexion réseau - Open-Meteo/);
  assert.equal(calls.length, 1);
});

test('erreur non passagère (404) : pas de relance', async () => {
  const { ctx, calls } = loadNet([{ status: 404 }]);
  await assert.rejects(ctx.get('https://geo.api.gouv.fr/communes'), /API Géo HTTP 404/);
  assert.equal(calls.length, 1);
});

// ---- Débit instantané (observations_tr, 30 jours glissants)
const qi = loadFunctions(src, ['qiPeriode', 'qiStats', 'qiAt', 'qiVariation', 'fetchQISerie'],
  { HUBEAU: 'https://hubeau.eaufrance.fr/api/v2/hydrometrie', enc: encodeURIComponent });
const H = 3600e3, T0 = Date.parse('2026-10-28T00:00:00Z');
const serie = Array.from({ length: 49 }, (_, i) => ({ t: T0 + i * H / 2, q: 1 + i / 10 }));   // 24 h au pas de 30 min

test('débit instantané : période, min / max / moyenne, dernier', () => {
  const r = qi.qiPeriode(serie, 0.5, T0 + 24 * H);            // 12 dernières heures
  assert.equal(r.length, 25); assert.equal(r[0].t, T0 + 12 * H);
  const s = qi.qiStats(serie);
  assert.equal(s.last, serie[48]); assert.equal(s.min, serie[0]); assert.equal(s.max, serie[48]);
  assert.ok(Math.abs(s.moy - 3.4) < 1e-9); assert.equal(s.n, 49);
  assert.equal(qi.qiStats([]), null);
});

test('débit instantané : valeur la plus proche d’une heure donnée, à 30 min près', () => {
  assert.equal(qi.qiAt(serie, T0 + 2 * H + 10 * 60e3), serie[4]);        // 02:10 → mesure de 02:00
  assert.equal(qi.qiAt(serie, T0 + 2 * H + 20 * 60e3), serie[5]);        // 02:20 → mesure de 02:30
  assert.equal(qi.qiAt(serie, T0 + 25 * H), null, 'au-delà de 30 min : pas de valeur');
});

test('débit instantané : variation sur 1 h et 24 h', () => {
  const v1 = qi.qiVariation(serie, 1);
  assert.ok(Math.abs(v1.dq - 0.2) < 1e-9);
  assert.ok(Math.abs(qi.qiVariation(serie, 24).dq - 4.8) < 1e-9);
  assert.equal(qi.qiVariation(serie.slice(0, 1), 1), null);
});

test('débit instantané : requête Hub’eau depuis une date, L/s → m³/s, pages suivies, valeurs nulles ignorées', async () => {
  const urls = [];
  const pleine = Array.from({ length: 20000 }, (_, i) => ({ date_obs: new Date(T0 + i * 1000).toISOString(), resultat_obs: 1000 }));   // 20 000 s, avant la page 2
  const pages = [{ data: pleine, next: 'https://hubeau.eaufrance.fr/page2' },
    { data: [{ date_obs: '2026-10-29T00:00:00Z', resultat_obs: 2500 }, { date_obs: '2026-10-29T00:05:00Z', resultat_obs: null }], next: 'https://hubeau.eaufrance.fr/page3' }];
  const f = loadFunctions(src, ['fetchQISerie'], { HUBEAU: 'https://hubeau.eaufrance.fr/api/v2/hydrometrie', enc: encodeURIComponent,
    hubGet: async u => { urls.push(u); return pages.shift(); } });
  const rows = await f.fetchQISerie('Y321002101', T0);
  assert.match(urls[0], /observations_tr\?code_entite=Y321002101&grandeur_hydro=Q&sort=asc&size=20000.*date_debut_obs=2026-10-28T00:00:00Z/);
  assert.equal(urls.length, 2, 'page incomplète : pas de page suivante');
  assert.equal(rows.length, 20001);
  assert.equal(rows[0].q, 1); assert.equal(rows[20000].q, 2.5);
});
