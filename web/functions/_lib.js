// Utilidades compartidas por las funciones de /api (el guion bajo hace que no sea una ruta).

export function json(cuerpo, estado, segundosCache) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': segundosCache ? `public, max-age=${segundosCache}` : 'no-store',
    },
  });
}

/**
 * Sirve desde la caché de Cloudflare si hay copia; si no, calcula y guarda. La caché solo funciona en un
 * dominio propio (rodalies.reloda.es); en *.pages.dev y en local se calcula siempre.
 */
export async function conCache(contexto, segundos, calcular) {
  const cache = caches.default;
  const clave = new Request(contexto.request.url, { method: 'GET' });
  const guardada = await cache.match(clave);
  if (guardada) return guardada;
  const respuesta = await calcular(contexto);
  // Solo se guarda lo que la propia respuesta dice que se puede cachear (no las vacías ni los errores).
  if (respuesta.ok && !respuesta.headers.get('cache-control')?.includes('no-store')) contexto.waitUntil(cache.put(clave, respuesta.clone()));
  return respuesta;
}
