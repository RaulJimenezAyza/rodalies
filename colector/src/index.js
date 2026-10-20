// Colector de Rodalies: cada minuto guarda en D1 el estado de todos los trenes de Rodalies (retraso y
// próxima parada) a partir del tiempo real de Renfe. Cada 10 minutos guarda también los avisos nuevos.
//
// Es lo primero que se pone en marcha porque el valor del proyecto es el histórico: Renfe solo da el
// "ahora", y cada minuto que no se guarda se pierde.
//
// GET /estado devuelve cuánto se lleva guardado (para comprobar que funciona).

import { extraerAvisos, extraerTrenes } from './rodalies.js';

const TRENES = 'https://gtfsrt.renfe.com/trip_updates.json';
const AVISOS = 'https://gtfsrt.renfe.com/alerts.json';

export default {
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(capturar(env, new Date(evento.scheduledTime)));
  },

  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/estado') return new Response('Colector de Rodalies', { status: 404 });
    const [capturas, avisos] = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS total, MIN(ts) AS primera, MAX(ts) AS ultima FROM capturas'),
      env.DB.prepare('SELECT COUNT(*) AS total FROM avisos'),
    ]);
    const c = capturas.results[0];
    const fecha = (s) => (s ? new Date(s * 1000).toISOString() : null);
    return Response.json({
      capturas: c.total,
      primera: fecha(c.primera),
      ultima: fecha(c.ultima),
      hace_segundos: c.ultima ? Math.round(Date.now() / 1000 - c.ultima) : null,
      avisos: avisos.results[0].total,
    });
  },
};

async function capturar(env, cuando) {
  const feed = await leer(TRENES);
  const { ts, trenes } = extraerTrenes(feed);
  if (!Number.isFinite(ts) || !trenes.length) throw new Error(`Feed de trenes vacío o sin marca de tiempo (${trenes.length} trenes)`);
  // Si Renfe no ha actualizado el feed desde la última vez, la marca de tiempo es la misma y no se duplica.
  await env.DB.prepare('INSERT OR IGNORE INTO capturas (ts, trenes) VALUES (?, ?)').bind(ts, JSON.stringify(trenes)).run();

  if (cuando.getUTCMinutes() % 10 === 0) {
    const avisos = extraerAvisos(await leer(AVISOS));
    const ahora = Math.round(Date.now() / 1000);
    if (avisos.length) {
      await env.DB.batch(avisos.map((a) =>
        env.DB.prepare('INSERT OR IGNORE INTO avisos (id, visto, inicio, fin, lineas, texto) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(a.id, ahora, a.inicio, a.fin, a.lineas.join(','), a.texto)
      ));
    }
  }
}

async function leer(url) {
  const r = await fetch(url, { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(`Renfe respondió ${r.status} en ${url}`);
  return r.json();
}
