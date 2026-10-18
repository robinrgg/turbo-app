// Outils navigateur pour les tests (Playwright, facultatif) : serveur statique local
// du dépôt + Chromium. Les bibliothèques CDN sont servies depuis tests/vendor/ si
// présentes (téléchargées au besoin), sinon bloquées.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* absent */ }
export const hasBrowser = !!chromium;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.csv': 'text/csv' };

// Bibliothèques CDN nécessaires aux graphiques (mêmes versions que les apps)
const CDN = {
  'chart.js@4.4.0/dist/chart.umd.min.js': 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'chartjs-plugin-annotation@3.0.1': 'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js',
  'xlsx@0.18.5/dist/xlsx.full.min.js': 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
};
const cdnCache = new Map();
async function cdnBody(url) {
  const key = Object.keys(CDN).find(k => url.includes(k));
  if (!key) return null;
  if (!cdnCache.has(key)) cdnCache.set(key, fetch(CDN[key]).then(r => r.ok ? r.text() : null).catch(() => null));
  return cdnCache.get(key);
}

export async function withBrowser(fn) {
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
  const open = async (p, { cdn = false } = {}) => {
    const page = await browser.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    await page.route(u => !u.href.startsWith(base), async r => {
      const body = cdn && await cdnBody(r.request().url());
      return body ? r.fulfill({ body, contentType: 'text/javascript' }) : r.abort();
    });
    await page.goto(base + p, { waitUntil: 'load' });
    return page;
  };
  try { return await fn({ open, base }); }
  finally { await browser.close(); server.close(); }
}
