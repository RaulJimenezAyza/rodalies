// GET /api/vivo → todo lo que la web necesita en directo, en una sola petición:
//   { ts, trenes: [[tren, línea, retraso_s, parada, cancelado], …],      ← última captura del colector (D1)
//     posiciones: [[tren, línea, lat, lon, estado, parada], …], tsPosiciones,  ← GPS de Renfe, ahora
//     avisos: [{ id, lineas, es, ca, inicio }, …] }                         ← avisos de Renfe activos
// estado: "P" parado en la estación, "L" llegando, "C" circulando hacia ella.
//
// Se cachea 20 s en Cloudflare: aunque mucha gente tenga la web abierta, a Renfe y a D1 se les pregunta
// como mucho tres veces por minuto.

import { conCache, json } from '../_lib.js';

const POSICIONES = 'https://gtfsrt.renfe.com/vehicle_positions.json';
// El prefijo cambia con el día de servicio: 5191M el martes, 5192X el miércoles… (51 = Rodalies).
const VIAJE_RODALIES = /^51\d{2}[A-Z](\d+)([A-Z].*)$/;
const ESTADO = { STOPPED_AT: 'P', INCOMING_AT: 'L', IN_TRANSIT_TO: 'C' };

export const onRequestGet = (contexto) =>
  conCache(contexto, 20, async ({ env }) => {
    const [fila, avisos, gps] = await Promise.all([
      env.DB.prepare('SELECT ts, trenes FROM capturas ORDER BY ts DESC LIMIT 1').first(),
      env.DB.prepare("SELECT valor FROM progreso WHERE clave = 'avisos_activos'").first('valor'),
      leerPosiciones().catch(() => null),
    ]);
    if (!fila) return json({ error: 'Aún no hay datos' }, 503, 0);
    return json({
      ts: fila.ts, trenes: JSON.parse(fila.trenes), posiciones: gps?.posiciones ?? [], tsPosiciones: gps?.ts ?? null,
      avisos: JSON.parse(avisos ?? '[]'),
    }, 200, 20);
  });

async function leerPosiciones() {
  // Si Renfe tarda más de 6 s, se sirven los retrasos sin posiciones antes que hacer esperar a la web.
  const r = await fetch(POSICIONES, { cf: { cacheTtl: 0 }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`Renfe respondió ${r.status}`);
  const feed = await r.json();
  const posiciones = [];
  for (const { vehicle: v } of feed.entity ?? []) {
    const encaje = v?.trip?.tripId?.match(VIAJE_RODALIES);
    const lat = v?.position?.latitude, lon = v?.position?.longitude;
    if (!encaje || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    posiciones.push([encaje[1], encaje[2], Number(lat.toFixed(5)), Number(lon.toFixed(5)), ESTADO[v.currentStatus] ?? 'C', v.stopId ?? null]);
  }
  return { ts: Number(feed.header?.timestamp) || null, posiciones };
}
