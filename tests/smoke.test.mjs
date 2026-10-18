// Test de fumée navigateur : chaque app (et le hub) se charge sans erreur JavaScript.
// Nécessite Playwright + Chromium ; ignoré proprement s'ils sont absents.
// Les CDN sont bloqués : seules les erreurs du code du dépôt comptent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, read } from './helpers.mjs';

let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* absent */ }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.csv': 'text/csv' };

test('chaque app se charge sans erreur JavaScript', { skip: !chromium && 'Playwright absent' }, async t => {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const body = await readFile(path.join(ROOT, p));
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  }).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const ctx = vm.createContext({ self: {} });
    vm.runInContext(read('apps.js'), ctx);
    const pages = ['/index.html', ...ctx.self.APPS.map(a => `/apps/${a.slug}/index.html`)];
    for (const p of pages) {
      await t.test(p, async () => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route(u => !u.href.startsWith(base), r => r.abort());
        await page.goto(base + p, { waitUntil: 'load' });
        await page.waitForTimeout(400);
        // Les bibliothèques CDN bloquées (Chart, L, XLSX) ne sont pas des erreurs du dépôt
        const own = errors.filter(m => !/\b(Chart|L|XLSX) is not defined/.test(m));
        assert.deepEqual(own, [], `${p} : ${own.join(' | ')}`);
        await page.close();
      });
    }
  } finally {
    await browser.close();
    server.close();
  }
});
