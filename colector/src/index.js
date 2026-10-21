// Colector de Rodalies: cada minuto guarda en D1 el estado de todos los trenes de Rodalies (retraso y
// próxima parada) a partir del tiempo real de Renfe. Cada 10 minutos guarda también los avisos nuevos, y
// cada hora (minuto 5) suma las capturas nuevas al resumen por tren y día y borra el crudo de hace 8 días.
//
// Es lo primero que se pone en marcha porque el valor del proyecto es el histórico: Renfe solo da el
// "ahora", y cada minuto que no se guarda se pierde.
//
// GET /estado devuelve cuánto se lleva guardado (para comprobar que funciona).

import { extraerAvisos, extraerTrenes } from './rodalies.js';
import { resumir, SQL_SUMAR } from './resumen.js';

export { Directo } from './directo.js'; // el "repetidor" que manda lo nuevo a todas las webs abiertas

const TRENES = 'https://gtfsrt.renfe.com/trip_updates.json';
const AVISOS = 'https://gtfsrt.renfe.com/alerts.json';

export default {
  async scheduled(evento, env, ctx) {
    const cuando = new Date(evento.scheduledTime);
    ctx.waitUntil(capturar(env, cuando));
    if (cuando.getUTCMinutes() === 5) ctx.waitUntil(resumirHora(env));
  },

  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/estado') return new Response('Colector de Rodalies', { status: 404 });
    const [capturas, avisos, resumen] = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS total, MIN(ts) AS primera, MAX(ts) AS ultima FROM capturas'),
      env.DB.prepare('SELECT COUNT(*) AS total FROM avisos'),
      env.DB.prepare("SELECT COUNT(*) AS trenes, COUNT(DISTINCT fecha) AS dias, (SELECT valor FROM progreso WHERE clave = 'resumido_hasta') AS hasta FROM resumen"),
    ]);
    const c = capturas.results[0];
    const fecha = (s) => (s ? new Date(s * 1000).toISOString() : null);
    return Response.json({
      capturas: c.total,
      primera: fecha(c.primera),
      ultima: fecha(c.ultima),
      hace_segundos: c.ultima ? Math.round(Date.now() / 1000 - c.ultima) : null,
      avisos: avisos.results[0].total,
      resumen: { trenes_dia: resumen.results[0].trenes, dias: resumen.results[0].dias, hasta: fecha(resumen.results[0].hasta) },
    });
  },
};

async function capturar(env, cuando) {
  const feed = await leer(TRENES);
  const { ts, trenes } = extraerTrenes(feed);
  if (!Number.isFinite(ts) || !trenes.length) throw new Error(`Feed de trenes vacío o sin marca de tiempo (${trenes.length} trenes)`);
  // Si Renfe no ha actualizado el feed desde la última vez, la marca de tiempo es la misma y no se duplica.
  await env.DB.prepare('INSERT OR IGNORE INTO capturas (ts, trenes) VALUES (?, ?)').bind(ts, JSON.stringify(trenes)).run();
  // Y se manda en directo a todas las webs abiertas (si falla, la web sigue pudiendo preguntar por /api/vivo).
  try {
    await env.DIRECTO.get(env.DIRECTO.idFromName('rodalies')).nuevosTrenes(ts, trenes);
  } catch (e) {
    console.warn('Directo:', e.message);
  }

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

// Suma al resumen las capturas que aún no estaban sumadas (como mucho 120, por si alguna hora falló).
// Todo en un solo batch: si algo falla, no se marca como hecho y se reintenta la hora siguiente.
async function resumirHora(env) {
  const hasta = (await env.DB.prepare("SELECT valor FROM progreso WHERE clave = 'resumido_hasta'").first('valor')) ?? 0;
  const { results } = await env.DB.prepare('SELECT ts, trenes FROM capturas WHERE ts > ? ORDER BY ts LIMIT 120').bind(hasta).all();
  if (!results.length) return;
  const capturas = results.map((r) => ({ ts: r.ts, trenes: JSON.parse(r.trenes) }));
  const sumas = resumir(capturas).map((f) =>
    env.DB.prepare(SQL_SUMAR).bind(f.fecha, f.tren, f.linea, f.primera, f.ultima, f.retraso_max, f.retraso_final, f.suma, f.n, f.cancelado, JSON.stringify(f.paradas))
  );
  const ultima = capturas.at(-1).ts;
  await env.DB.batch([
    ...sumas,
    env.DB.prepare("INSERT INTO progreso (clave, valor) VALUES ('resumido_hasta', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor").bind(ultima),
    env.DB.prepare('DELETE FROM capturas WHERE ts < ?').bind(ultima - 8 * 86400),
  ]);
}

async function leer(url) {
  const r = await fetch(url, { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(`Renfe respondió ${r.status} en ${url}`);
  return r.json();
}
