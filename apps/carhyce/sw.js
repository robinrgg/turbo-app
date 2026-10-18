/* ============================================================
   Service worker de RETRAIT — CARHYCE
   ------------------------------------------------------------
   L'app est désormais servie par le service worker racine du hub
   (../../sw.js), qui gère seul le cache et le hors-ligne.

   Ce fichier remplace l'ancien SW propre à l'app, encore installé sur
   certains appareils : à sa prochaine mise à jour, il supprime UNIQUEMENT
   ses propres caches de fichiers (préfixe 'carhyce-'), se désinstalle, puis
   recharge les pages ouvertes pour qu'elles passent sous le SW racine.

   Les données de saisie (IndexedDB, localStorage) ne sont jamais touchées.
   À conserver tant que des appareils peuvent porter l'ancien SW.
   ============================================================ */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('carhyce-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url).catch(() => {}));
  })());
});
