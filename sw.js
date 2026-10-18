/* ============================================================
   SERVICE WORKER RACINE — Turbo App
   ------------------------------------------------------------
   Un seul SW pour tout le hub (scope = racine du dépôt).
   Trois stratégies de routage :

     1. Hôtes de données temps réel (Hub'Eau, Open-Meteo,
        geo.api.gouv.fr) -> RÉSEAU SEUL. Jamais de cache : on ne sert pas de
           débit périmé.
     2. Ressources cross-origin figées (SheetJS, polices,
        Leaflet, Chart.js) -> CACHE-FIRST. Mises en cache au
        premier chargement en ligne, dispo ensuite hors-ligne.
     3. Même origine (shell + apps) -> NETWORK-FIRST avec
        timeout court + fallback cache. Les MAJ poussées sur
        Pages arrivent dès qu'on est en ligne ; autonomie
        totale hors connexion pour les apps précachées.

   La liste de précache (precache-manifest.js) est GÉNÉRÉE par
   build_sw_assets.py : ne pas l'éditer à la main.
   ============================================================ */

importScripts('./apps.js');              // -> self.APPS
importScripts('./precache-manifest.js'); // -> self.PRECACHE + self.PRECACHE_VERSION

const CACHE   = self.PRECACHE_VERSION || 'turbo-v0';
const PRECACHE = self.PRECACHE || ['./', './index.html', './apps.js'];
const NETWORK_TIMEOUT_MS = 3000;

// Hôtes servis exclusivement depuis le réseau (données vivantes)
const LIVE_API_HOSTS = [
  'hubeau.eaufrance.fr',
  'api.open-meteo.com',
  'geo.api.gouv.fr'
];

// Réponse synthétique quand le réseau est injoignable : l'en-tête permet aux
// apps de distinguer « pas de connexion » d'une vraie erreur du serveur distant.
const OFFLINE_HEADER = 'X-Turbo-Offline';

// Stratégie de cache pour une URL : 'live' | 'cdn' | 'local'
function strategyFor(url) {
  if (LIVE_API_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return 'live';
  if (url.origin !== self.location.origin) return 'cdn';
  return 'local';
}

// ----- Installation : pré-cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(PRECACHE.map(url =>
        cache.add(url).catch(err => console.warn('SW précache ignoré:', url, err))
      ))
    ).then(() => self.skipWaiting())
  );
});

// ----- Activation : purge des anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ----- Routage des requêtes
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  const strategy = strategyFor(url);

  // 1) APIs temps réel -> réseau seul
  if (strategy === 'live') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response('Hors ligne — données temps réel indisponibles', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', [OFFLINE_HEADER]: '1' }
        })
      )
    );
    return;
  }

  // 2) Cross-origin (CDN figés) -> cache-first
  if (strategy === 'cdn') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // 3) Même origine -> network-first
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  try {
    const resp = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (resp && resp.ok) (await caches.open(CACHE)).put(request, resp.clone());
    return resp;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Navigation profonde non précachée et hors-ligne -> repli sur le launcher
    if (request.mode === 'navigate') {
      const home = await caches.match('./index.html');
      if (home) return home;
    }
    return new Response('Ressource indisponible (hors ligne)', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // rafraîchissement silencieux en tâche de fond
    fetch(request).then(r => {
      if (r && r.ok) caches.open(CACHE).then(c => c.put(request, r));
    }).catch(() => {});
    return cached;
  }
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) (await caches.open(CACHE)).put(request, resp.clone());
    return resp;
  } catch (e) {
    return new Response('Ressource externe indisponible', { status: 503 });
  }
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      r => { clearTimeout(id); resolve(r); },
      e => { clearTimeout(id); reject(e); }
    );
  });
}

// Permet à une nouvelle version de prendre le contrôle immédiatement
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
