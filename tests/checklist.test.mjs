import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inlineScripts, extractConst } from './helpers.mjs';
import { hasBrowser, withBrowser } from './browser.mjs';

const src = inlineScripts('apps/checklist/index.html');
const ctx = vm.createContext({});
vm.runInContext(['GROUPS', 'MODES', 'CAT_CLASS'].map(n => extractConst(src, n)).join('\n') + ';this.GROUPS=GROUPS;this.MODES=MODES;this.CAT_CLASS=CAT_CLASS;', ctx);
const { GROUPS, MODES, CAT_CLASS } = JSON.parse(JSON.stringify({ GROUPS: ctx.GROUPS, MODES: ctx.MODES, CAT_CLASS: ctx.CAT_CLASS }));

test('checklist : chaque mode appartient à un groupe existant, chaque groupe a au moins un mode', () => {
  const ids = new Set(GROUPS.map(g => g.id));
  for (const [id, m] of Object.entries(MODES)) assert.ok(ids.has(m.group), `${id} → groupe ${m.group}`);
  for (const g of GROUPS) assert.ok(Object.values(MODES).some(m => m.group === g.id), `groupe ${g.id} vide`);
});

test('checklist : aucun article en double dans une section (sinon cocher l’un coche l’autre)', () => {
  const doublons = [];
  for (const [id, m] of Object.entries(MODES)) for (const sec of m.sections) {
    const vus = new Set();
    for (const it of sec.items) { if (vus.has(it.n)) doublons.push(`${id} / ${sec.title} / ${it.n}`); vus.add(it.n); }
  }
  assert.deepEqual(doublons, []);
});

test('checklist : titres de section uniques par mode (identifiants HTML distincts)', () => {
  for (const [id, m] of Object.entries(MODES)) {
    const ids = m.sections.map(s => s.title.replace(/\s+/g, '_'));
    assert.equal(new Set(ids).size, ids.length, id);
  }
});

test('checklist : chaque article a un nom et une catégorie connue', () => {
  const inconnues = new Set();
  for (const m of Object.values(MODES)) for (const sec of m.sections) for (const it of sec.items) {
    assert.ok(it.n && it.n.trim(), 'nom vide');
    if (!CAT_CLASS[it.c]) inconnues.add(it.c);
  }
  assert.deepEqual([...inconnues], [], 'catégories sans style');
});

test('checklist : cocher, recharger, compteurs cohérents ; sauvegarde corrompue sans plantage', { skip: !hasBrowser && 'Playwright absent' }, async () => {
  await withBrowser(async ({ open }) => {
    const page = await open('/apps/checklist/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const total = +(await page.textContent('#pg-total'));
    assert.ok(total > 0);
    const items = page.locator('.item');
    await items.nth(0).click(); await items.nth(2).click();
    assert.equal(await page.textContent('#pg-done'), '2');
    await page.reload();
    assert.equal(await page.textContent('#pg-done'), '2', 'cases cochées conservées');
    assert.equal(await page.locator('.item.checked').count(), 2);
    assert.equal(await page.textContent('#fl-miss'), String(total - 2));
    assert.deepEqual(page.errors, []);
    await page.evaluate(() => localStorage.setItem('cl_checks_v2', '{corrompu'));
    await page.reload();
    page.fautes = page.errors.slice();
    assert.deepEqual(page.fautes, [], 'une sauvegarde illisible ne doit pas bloquer l’app');
  });
});
