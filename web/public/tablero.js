// Lógica del panel de salidas (funciones puras, con tests).

const TRES_HORAS = 3 * 3600_000;
const RETRASO = 3; // minutos a partir de los que se marca un tren como retrasado

/** Día de servicio (AAAA-MM-DD) y minutos desde su medianoche; antes de las 3:00 aún es el día anterior. */
export function momentoDeServicio(fecha = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(fecha.getTime() - TRES_HORAS)).map((x) => [x.type, x.value])
  );
  return { dia: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) + 180 };
}

/** "07:42" → 462; "24:15" → 1455 (los horarios de después de medianoche siguen contando). */
export const aMinutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 1455 → "00:15" */
export const aHora = (minutos) => `${String(Math.floor(minutos / 60) % 24).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

/**
 * Próximos trenes que salen de una estación.
 * @param {Array<[string, string, Array<[string, string]>]>} horario viajes del día: [tren, línea, [[parada, "HH:MM"], …]]
 * @param {string} parada id de la estación
 * @param {number} ahora minutos de servicio (momentoDeServicio().minutos)
 * @param {Map<string, [string, string, number|null, string|null, 0|1]>} vivo última captura, por "tren|línea"
 * @returns {Array<{ tren, linea, hora, minutos, destino, estado: 'cancelado'|'retraso'|'hora'|'sin-salir'|'sin-datos', retraso, estimada }>}
 */
export function proximasSalidas(horario, parada, ahora, vivo, { antes = 2, despues = 120, maximo = 12 } = {}) {
  const salidas = [];
  for (const [tren, linea, paradas] of horario) {
    const i = paradas.findIndex(([p]) => p === parada);
    if (i === -1 || i === paradas.length - 1) continue; // no pasa por aquí o termina aquí
    const minutos = aMinutos(paradas[i][1]);
    const real = vivo.get(`${tren}|${linea}`);
    let estado, retraso = 0;
    if (real?.[4]) estado = 'cancelado';
    else if (real && real[2] !== null) {
      retraso = Math.max(0, Math.round(real[2] / 60));
      estado = retraso >= RETRASO ? 'retraso' : 'hora'; // 1 o 2 minutos se dan por buenos
    } else estado = aMinutos(paradas[0][1]) > ahora ? 'sin-salir' : 'sin-datos';
    const estimada = minutos + retraso;
    if (estimada < ahora - antes || minutos > ahora + despues) continue;
    salidas.push({ tren, linea, hora: paradas[i][1], minutos, destino: paradas.at(-1)[0], estado, retraso, estimada });
  }
  return salidas.sort((a, b) => a.estimada - b.estimada || a.minutos - b.minutos).slice(0, maximo);
}

/** Resumen de la última captura: cuántos circulan, cuántos con retraso (≥ umbral) y el peor. */
export function resumenAhora(trenes, umbral = 300) {
  const enMarcha = trenes.filter((t) => !t[4] && t[2] !== null);
  const conRetraso = enMarcha.filter((t) => t[2] >= umbral);
  const peor = enMarcha.reduce((a, t) => (!a || t[2] > a[2] ? t : a), null);
  return { total: enMarcha.length, conRetraso: conRetraso.length, cancelados: trenes.filter((t) => t[4]).length, peor };
}

/** Texto blanco o casi negro sobre el color de una línea, según su luminancia. */
export function textoSobre(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}
