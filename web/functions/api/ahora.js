// GET /api/ahora → la última captura del colector: { ts, trenes: [[tren, línea, retraso_s, parada, cancelado], …] }
// Lee una sola fila de D1 y se cachea 30 s en Cloudflare (en el dominio propio).

import { conCache, json } from '../_lib.js';

export const onRequestGet = (contexto) =>
  conCache(contexto, 30, async ({ env }) => {
    const fila = await env.DB.prepare('SELECT ts, trenes FROM capturas ORDER BY ts DESC LIMIT 1').first();
    if (!fila) return json({ error: 'Aún no hay datos' }, 503, 0);
    return json({ ts: fila.ts, trenes: JSON.parse(fila.trenes) }, 200, 30);
  });
