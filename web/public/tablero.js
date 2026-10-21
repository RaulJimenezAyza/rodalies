// Lógica del panel de salidas (funciones puras, con tests).

const TRES_HORAS = 3 * 3600_000;
/** Minutos a partir de los que un tren va «tarde» (en toda la web) y «muy tarde». */
export const TARDE = 5;
export const MUY_TARDE = 10;

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
 * @returns {Array<{ tren, linea, hora, minutos, destino, estado: 'cancelado'|'retraso'|'leve'|'hora'|'sin-salir'|'sin-datos', retraso, estimada }>}
 *   leve: 1–4 min de retraso; retraso: TARDE minutos o más.
 */
export function proximasSalidas(horario, parada, ahora, vivo, { antes = 2, despues = 120, maximo = 12 } = {}) {
  const salidas = [];
  for (const viaje of horario) {
    const [tren, linea, paradas] = viaje;
    const i = paradas.findIndex(([p]) => p === parada);
    if (i === -1 || i === paradas.length - 1) continue; // no pasa por aquí o termina aquí
    if (yaPasado(viaje, i, vivo)) continue;
    const minutos = aMinutos(paradas[i][1]);
    const { estado, retraso } = estadoDe(viaje, ahora, vivo);
    const estimada = minutos + retraso;
    if (estimada < ahora - antes || minutos > ahora + despues) continue;
    salidas.push({ tren, linea, hora: paradas[i][1], minutos, destino: paradas.at(-1)[0], estado, retraso, estimada });
  }
  return salidas.sort((a, b) => a.estimada - b.estimada || a.minutos - b.minutos).slice(0, maximo);
}

/** Según Renfe, el tren ya va por una parada posterior a la `i`: ya no se puede coger ahí. */
function yaPasado([tren, linea, paradas], i, vivo) {
  const actual = vivo.get(`${tren}|${linea}`)?.[3];
  if (!actual) return false;
  const k = paradas.findIndex(([p]) => p === actual);
  return k > i;
}

/** Estado de un viaje ahora: bus, cancelado, retraso (TARDE o más), leve (1–4 min), hora, sin-salir o sin-datos. */
export function estadoDe([tren, linea, paradas, bus], ahora, vivo) {
  const real = vivo.get(`${tren}|${linea}`);
  if (bus) return { estado: 'bus', retraso: 0 }; // servicio por carretera: sin seguimiento en directo
  if (real?.[4]) return { estado: 'cancelado', retraso: 0 };
  if (real && real[2] !== null) {
    const retraso = Math.max(0, Math.round(real[2] / 60));
    return { estado: retraso >= TARDE ? 'retraso' : retraso >= 1 ? 'leve' : 'hora', retraso };
  }
  return { estado: aMinutos(paradas[0][1]) > ahora ? 'sin-salir' : 'sin-datos', retraso: 0 };
}

/**
 * Próximos trenes que van de una estación a otra (en ese sentido), con la hora a la que salen y llegan de verdad:
 * la prevista más el retraso que lleva ahora el tren (si aún no ha llegado, puede recuperar o perder algo).
 */
export function proximosViajes(horario, origen, destino, ahora, vivo, { antes = 2, despues = 180, maximo = 8 } = {}) {
  const viajes = [];
  for (const viaje of horario) {
    const [tren, linea, paradas] = viaje;
    const i = paradas.findIndex(([p]) => p === origen);
    if (i === -1) continue;
    const j = paradas.findIndex(([p], k) => k > i && p === destino);
    if (j === -1) continue; // no llega a destino, o va en el otro sentido
    if (yaPasado(viaje, i, vivo)) continue;
    const sale = aMinutos(paradas[i][1]);
    const llega = aMinutos(paradas[j][1]);
    const { estado, retraso } = estadoDe(viaje, ahora, vivo);
    const saleEstimada = sale + retraso;
    if (saleEstimada < ahora - antes || sale > ahora + despues) continue;
    viajes.push({
      tren, linea, estado, retraso, final: paradas.at(-1)[0],
      sale, llega, saleEstimada, llegaEstimada: llega + retraso, duracion: llega - sale, paradas: j - i,
    });
  }
  return viajes.sort((a, b) => a.saleEstimada - b.saleEstimada || a.sale - b.sale).slice(0, maximo);
}

/**
 * Recorrido de un tren parada a parada, con la hora prevista y la estimada (prevista + retraso actual).
 * `pasada`: ya ha pasado por ahí (según la parada que da Renfe como actual). `actual`: la parada en la que está o a la que llega.
 */
export function recorrido(viaje, vivo) {
  const [tren, linea, paradas] = viaje;
  const real = vivo.get(`${tren}|${linea}`);
  const retraso = real && real[2] !== null && !real[4] ? Math.max(0, Math.round(real[2] / 60)) : 0;
  const actual = real?.[3] ? paradas.findIndex(([p]) => p === real[3]) : -1;
  return paradas.map(([parada, hora], k) => {
    const minutos = aMinutos(hora);
    return { parada, hora, minutos, estimada: minutos + retraso, pasada: actual > -1 && k < actual, actual: k === actual };
  });
}

/**
 * Por línea: cuántos trenes deberían estar circulando ahora según el horario (sin contar autobuses) y de
 * cuántos da datos Renfe. Si faltan casi todos, lo más probable es que no estén circulando.
 * @returns {Map<string, { previstos: number, conDatos: number }>}
 */
export function cobertura(horario, vivo, ahora) {
  const porLinea = new Map();
  for (const [tren, linea, paradas, bus] of horario) {
    if (bus || aMinutos(paradas[0][1]) > ahora || aMinutos(paradas.at(-1)[1]) < ahora) continue;
    const c = porLinea.get(linea) ?? { previstos: 0, conDatos: 0 };
    c.previstos++;
    if (vivo.has(`${tren}|${linea}`)) c.conDatos++;
    porLinea.set(linea, c);
  }
  return porLinea;
}

/** Líneas en las que, según la cobertura, casi ningún tren que debería circular da señales (al menos 3 previstos). */
export const lineasSinDatos = (cob) => [...cob].filter(([, c]) => c.previstos >= 3 && c.conDatos / c.previstos < 0.3).map(([l]) => l).sort();

/** Líneas que paran en una estación hoy (para saber qué avisos le interesan a quien sale de ahí). */
export function lineasDeEstacion(horario, parada) {
  const lineas = new Set();
  for (const [, linea, paradas] of horario) if (paradas.some(([p]) => p === parada)) lineas.add(linea);
  return lineas;
}

/** Resumen de la última captura: cuántos circulan, cuántos con retraso (≥ umbral) y el peor. */
export function resumenAhora(trenes, umbral = 300) {
  const enMarcha = trenes.filter((t) => !t[4] && t[2] !== null);
  const conRetraso = enMarcha.filter((t) => t[2] >= umbral);
  const peor = enMarcha.reduce((a, t) => (!a || t[2] > a[2] ? t : a), null);
  return { total: enMarcha.length, conRetraso: conRetraso.length, cancelados: trenes.filter((t) => t[4]).length, peor };
}

/** Texto blanco o casi negro sobre el color de una línea: el que más contraste da (WCAG). */
export function textoSobre(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luz = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const conBlanco = 1.05 / (luz + 0.05);
  const conNegro = (luz + 0.05) / (0.0056 + 0.05); // #111111
  return conNegro > conBlanco ? '#111111' : '#ffffff';
}

/** Para buscar sin tildes ni mayúsculas: "Mataró" → "mataro". */
export const normalizar = (texto) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Estaciones que encajan con lo escrito: todas las palabras tienen que aparecer (sin tildes ni mayúsculas)
 * y van primero las que empiezan por lo escrito. @param {Record<string, [string]>} paradas
 */
export function buscarEstaciones(paradas, texto, maximo = 8) {
  const palabras = normalizar(texto).split(/[\s,.-]+/).filter(Boolean);
  if (!palabras.length) return [];
  const encajan = [];
  for (const [id, [nombre]] of Object.entries(paradas)) {
    const n = normalizar(nombre);
    if (!palabras.every((p) => n.includes(p))) continue;
    const sinCiudad = n.replace(/^barcelona[- ]/, '');
    const nota = sinCiudad.startsWith(palabras[0]) || n.startsWith(palabras[0]) ? 0 : n.split(/[\s-]+/).some((w) => w.startsWith(palabras[0])) ? 1 : 2;
    encajan.push({ id, nombre, nota });
  }
  return encajan.sort((a, b) => a.nota - b.nota || a.nombre.localeCompare(b.nombre, 'es')).slice(0, maximo);
}

/** Estación más cercana a unas coordenadas (distancia aproximada en km, buena a esta escala). */
export function estacionMasCercana(paradas, lat, lon) {
  let mejor = null;
  for (const [id, [nombre, la, lo]] of Object.entries(paradas)) {
    const d = Math.hypot((la - lat) * 111, (lo - lon) * 111 * Math.cos((lat * Math.PI) / 180));
    if (!mejor || d < mejor.km) mejor = { id, nombre, km: d };
  }
  return mejor;
}
