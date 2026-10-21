// Service worker: hace la web instalable y que abra sin conexión con lo último que se vio.
// Todo va "primero la red" (siempre lo más nuevo); sin conexión, la copia guardada. Solo se guarda lo de
// esta web: el mapa base (OpenFreeMap) lo gestiona el propio navegador.
const VERSION = 'rodalies-v17';
const BASE = ['/', '/estilos.css', '/app.js', '/tablero.js', '/mapa.js', '/iconos.js', '/cafe.js', '/i18n.js', '/fuentes/archivo.woff2',
  '/vendor/maplibre-gl.js', '/vendor/maplibre-gl.css',
  '/datos/paradas.json', '/datos/lineas.json', '/datos/trazados.json', '/icono.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  e.respondWith(primeroLaRed(request));
});

async function primeroLaRed(request) {
  const cache = await caches.open(VERSION);
  try {
    const respuesta = await fetch(request);
    if (respuesta.ok) cache.put(request, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (guardada) return guardada;
    if (request.mode === 'navigate') return (await cache.match('/')) ?? Response.error();
    throw error;
  }
}
