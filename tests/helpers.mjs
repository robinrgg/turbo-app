// Outils de test : charge des fonctions réelles depuis le code des apps (scripts
// inline des index.html ou fichiers .js) dans un contexte isolé, sans DOM.
// Aucune dépendance : uniquement la bibliothèque standard de Node.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

// Concatène les <script> inline (sans src) d'une page HTML.
export function inlineScripts(rel) {
  const html = read(rel);
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}

// Avance de `i` jusqu'au caractère fermant correspondant à `open` (déjà consommé),
// en ignorant chaînes, gabarits `...${}...` et commentaires. Retourne l'index après la fermeture.
function skipBalanced(src, i, open, close) {
  let depth = 1;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 2; continue; }
    if (c === '"' || c === "'") { i++; while (src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; continue; }
    if (c === '`') {
      i++;
      while (src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { i = skipBalanced(src, i + 2, '{', '}'); continue; }
        i++;
      }
      i++; continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
    i++;
  }
  throw new Error('Bloc non refermé');
}

// Source d'une déclaration de fonction de premier niveau (`function nom(...) {...}`).
export function extractFunction(src, name) {
  const m = new RegExp(`^[ \\t]*(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(src);
  if (!m) throw new Error(`Fonction introuvable : ${name}`);
  const start = m.index;
  let i = skipBalanced(src, m.index + m[0].length, '(', ')');
  i = src.indexOf('{', i);
  return src.slice(start, skipBalanced(src, i + 1, '{', '}'));
}

// Évalue les fonctions demandées dans un contexte (objet global) et le retourne.
export function loadFunctions(src, names, globals = {}) {
  const ctx = vm.createContext({ console, Math, JSON, Date, ...globals });
  vm.runInContext(names.map(n => extractFunction(src, n)).join('\n'), ctx);
  return ctx;
}

// Charge un fichier .js entier et expose les déclarations `const` demandées.
export function loadFile(rel, exportsNames = [], globals = {}) {
  const ctx = vm.createContext({ console, Math, JSON, Date, ...globals });
  vm.runInContext(read(rel) + '\n;' + exportsNames.map(n => `this.${n} = ${n};`).join(''), ctx);
  return ctx;
}
