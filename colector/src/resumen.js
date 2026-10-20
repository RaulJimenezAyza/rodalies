// Resumen por tren y día a partir de las capturas de cada minuto (funciones puras, con tests).
//
// Cada hora el colector resume las capturas nuevas y las suma al resumen del día en D1 (un UPSERT por
// tren). Así el resumen está siempre al día y cuesta unas 60 lecturas y ~120 escrituras por hora, en vez
// de recorrer el día entero de golpe.

const TRES_HORAS = 3 * 3600;

/**
 * Día de servicio (AAAA-MM-DD) de una marca de tiempo: el día en Madrid, contando que un tren que circula
 * a las 00:30 o a las 2:00 todavía es del día anterior (Rodalies no circula entre las 3 y las 4).
 */
export function diaDeServicio(ts) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date((ts - TRES_HORAS) * 1000));
}

/**
 * @param {{ ts: number, trenes: Array<[string, string, number|null, string|null, 0|1]> }[]} capturas
 * @returns {Array<{ fecha, tren, linea, primera, ultima, retraso_max, retraso_final, suma, n, cancelado, paradas }>}
 *   `paradas`: { parada: retraso_s } con el último retraso visto mientras era su próxima parada.
 *   `suma` y `n` permiten sacar el retraso medio sumando horas.
 */
export function resumir(capturas) {
  const porTren = new Map();
  for (const { ts, trenes } of [...capturas].sort((a, b) => a.ts - b.ts)) {
    const fecha = diaDeServicio(ts);
    for (const [tren, linea, retraso, parada, cancelado] of trenes) {
      const clave = `${fecha}|${tren}|${linea}`;
      let r = porTren.get(clave);
      if (!r) {
        r = { fecha, tren, linea, primera: ts, ultima: ts, retraso_max: null, retraso_final: null, suma: 0, n: 0, cancelado: 0, paradas: {} };
        porTren.set(clave, r);
      }
      r.ultima = ts;
      if (cancelado) r.cancelado = 1;
      if (retraso !== null) {
        r.retraso_max = r.retraso_max === null ? retraso : Math.max(r.retraso_max, retraso);
        r.retraso_final = retraso;
        r.suma += retraso;
        r.n++;
        if (parada) {
          delete r.paradas[parada]; // al volver a escribirla queda al final: el orden es el de paso
          r.paradas[parada] = retraso;
        }
      }
    }
  }
  return [...porTren.values()];
}

/** UPSERT que suma una hora al resumen del día de un tren. */
export const SQL_SUMAR = `
INSERT INTO resumen (fecha, tren, linea, primera, ultima, retraso_max, retraso_final, suma, n, cancelado, paradas)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
ON CONFLICT (fecha, tren, linea) DO UPDATE SET
  primera = MIN(primera, excluded.primera),
  ultima = MAX(ultima, excluded.ultima),
  retraso_max = CASE WHEN retraso_max IS NULL THEN excluded.retraso_max
                     WHEN excluded.retraso_max IS NULL THEN retraso_max
                     ELSE MAX(retraso_max, excluded.retraso_max) END,
  retraso_final = CASE WHEN excluded.ultima >= ultima AND excluded.retraso_final IS NOT NULL THEN excluded.retraso_final ELSE retraso_final END,
  suma = suma + excluded.suma,
  n = n + excluded.n,
  cancelado = MAX(cancelado, excluded.cancelado),
  paradas = json_patch(paradas, excluded.paradas)`;
