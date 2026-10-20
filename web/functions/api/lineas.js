// GET /api/lineas?dias=7 → puntualidad de cada línea en los últimos días, a partir del resumen por tren.
//
// Un tren cuenta como puntual si llegó (último retraso visto) con menos de 5 minutos de retraso; los
// cancelados cuentan aparte. Se cachea 30 minutos: el resumen solo cambia una vez por hora y así cada
// visita casi nunca llega a D1.

import { conCache, json } from '../_lib.js';

const PUNTUAL = 300; // segundos

export const onRequestGet = (contexto) =>
  conCache(contexto, 1800, async ({ env, request }) => {
    const pedidos = Number(new URL(request.url).searchParams.get('dias') ?? 7);
    const dias = Math.min(30, Math.max(1, Number.isFinite(pedidos) ? Math.round(pedidos) : 7));
    const desde = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() - (dias - 1) * 86400000));
    const { results } = await env.DB.prepare(`
      SELECT linea,
             COUNT(*) AS trenes,
             SUM(cancelado) AS cancelados,
             SUM(CASE WHEN cancelado = 0 AND retraso_final IS NOT NULL THEN 1 ELSE 0 END) AS con_dato,
             SUM(CASE WHEN cancelado = 0 AND retraso_final IS NOT NULL AND retraso_final < ?2 THEN 1 ELSE 0 END) AS puntuales,
             ROUND(SUM(suma) * 1.0 / NULLIF(SUM(n), 0)) AS retraso_medio,
             MAX(retraso_max) AS peor,
             MIN(fecha) AS primera_fecha
      FROM resumen WHERE fecha >= ?1 GROUP BY linea`).bind(desde, PUNTUAL).all();
    // Sin datos todavía (antes del primer resumen) no se cachea, para no quedarse 30 minutos en blanco.
    return json({ desde, dias, umbral: PUNTUAL, lineas: results }, 200, results.length ? 1800 : 0);
  });
