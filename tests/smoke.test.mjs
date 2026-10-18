// Test de fumée navigateur : chaque app (et le hub) se charge sans erreur JavaScript.
// Nécessite Playwright + Chromium ; ignoré proprement s'ils sont absents.
// Les CDN sont bloqués : seules les erreurs du code du dépôt comptent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read } from './helpers.mjs';
import { hasBrowser, withBrowser } from './browser.mjs';

test('chaque app se charge sans erreur JavaScript', { skip: !hasBrowser && 'Playwright absent' }, async t => {
  const ctx = vm.createContext({ self: {} });
  vm.runInContext(read('apps.js'), ctx);
  const pages = ['/index.html', ...ctx.self.APPS.map(a => `/apps/${a.slug}/index.html`)];
  await withBrowser(async ({ open }) => {
    for (const p of pages) {
      await t.test(p, async () => {
        const page = await open(p);
        await page.waitForTimeout(400);
        // Les bibliothèques CDN bloquées (Chart, L, XLSX) ne sont pas des erreurs du dépôt
        const own = page.errors.filter(m => !/\b(Chart|L|XLSX) is not defined/.test(m));
        assert.deepEqual(own, [], `${p} : ${own.join(' | ')}`);
        await page.close();
      });
    }
  });
});
