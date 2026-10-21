import {
  MUY_TARDE, TARDE, aHora, buscarEstaciones, estacionMasCercana, estadoDe, momentoDeServicio, proximasSalidas, proximosViajes, recorrido,
  resumenAhora, textoSobre, cobertura, lineasDeEstacion, lineasSinDatos,
} from './tablero.js';
import { icono } from './iconos.js';
import { crearMapa } from './mapa.js';
import { prepararCafe } from './cafe.js';
import { idioma, locale, t } from './i18n.js';
const tr = t; // alias para donde una variable local se llama `t` (un tren)

const ATAJOS = ['71801', '71802', '78805', '79009', '79400']; // Sants, Pg. de Gràcia, Pl. Catalunya, Clot, Estació de França
const UMBRAL = TARDE * 60; // segundos: a partir de ahí un tren va «tarde» en toda la web
const CADA = 60_000; // plan B: si no llega nada en directo, cada cuánto se pide /api/vivo (solo con la pestaña visible)
const VIEJO = 150; // segundos: a partir de ahí se avisa de que los datos no son de ahora
const VISTAS = ['viaje', 'mapa', 'red'];
const $ = (id) => document.getElementById(id);
const parametros = new URLSearchParams(location.search);
const estado = {
  paradas: {}, lineas: {}, trazados: null, horario: null, dia: null, destinos: new Map(), viajes: new Map(),
  vivo: new Map(), posiciones: [], ts: 0,
  origen: parametros.get('desde') || parametros.get('estacion') || leer('estacion') || '71801',
  destino: parametros.get('hasta') || leer('destino') || '',
  propia: Boolean(parametros.get('desde') || parametros.get('estacion') || leer('estacion')), // elegida por la persona o de ejemplo
  vista: VISTAS.includes(parametros.get('vista')) ? parametros.get('vista') : 'viaje',
  filtro: new Set(), mapa: null,
  previo: { clave: null, filas: new Map() }, // lo que mostraba el panel, para girar solo lo que cambia
  puntualidad: new Map(), desde: null, // por línea, de /api/lineas (para la ficha de cada línea)
  fichasAbiertas: new Set(), // fichas de línea con la lista de trenes completa
  hoja: null, // tren abierto en la hoja de paradas: { tren, linea, origen, destino }
  avisos: [], // avisos de Renfe activos: [{ id, lineas, es, ca, inicio }]
  cobertura: new Map(), sinDatos: new Set(), // líneas de las que Renfe casi no da datos (puede que no circulen)
};
globalThis.__rodalies = estado; // para depurar desde la consola (y para las pruebas con Playwright)

const minutos = (s) => Math.round(s / 60);
const numero = (n, dec = 0) => n.toLocaleString(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
const nombre = (id) => estado.paradas[id]?.[0] ?? id;
const corto = (id) => nombre(id).replace(/^Barcelona[- ]/, '');
const colorDe = (linea) => estado.lineas[linea]?.color ?? '777777';
const chip = (linea) => `<span class="linea-chip" style="background:#${colorDe(linea)};color:${textoSobre(colorDe(linea))}">${linea}</span>`;
const esOscuro = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fechaCorta = (f) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${f}T12:00:00Z`));
const enCuanto = (min) => (min <= 0 ? t('saliendo ya') : min < 60 ? t('sale en {n} min', { n: min }) : t('sale en {h} h {m} min', { h: Math.floor(min / 60), m: min % 60 }));

/** El estado de un tren dicho en palabras, para que lo entienda cualquiera. */
function frase(estadoTren, retraso, linea) {
  if (estadoTren === 'sin-datos' && estado.sinDatos.has(linea)) return t('Sin datos de Renfe · puede que no circule');
  return {
    retraso: t('Va {n} minutos tarde', { n: retraso }),
    leve: retraso === 1 ? t('Va 1 minuto tarde') : t('Va {n} minutos tarde', { n: retraso }),
    hora: t('Va a su hora'),
    'sin-salir': t('Aún no ha salido · hora prevista'),
    'sin-datos': t('Renfe no da su posición · hora prevista'),
    bus: t('Autobús por obras · hora prevista'),
    cancelado: t('Cancelado'),
  }[estadoTren];
}
const claseEstado = (e, retraso) => ({ cancelado: 'estado-cancelado', retraso: retraso >= MUY_TARDE ? 'estado-cancelado' : 'estado-retraso', leve: 'estado-leve', hora: 'estado-hora', bus: 'estado-bus' }[e] ?? 'estado-sin');

function leer(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function recientes() {
  try { return JSON.parse(leer('recientes') || '[]').filter((id) => typeof id === 'string'); } catch { return []; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch {}
}

iniciar();

async function iniciar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  prepararTema();
  prepararReloj();
  prepararCafe();
  prepararVistas();
  prepararSugerencias();
  prepararIdiomas();
  $('buscador-icono').innerHTML = icono('buscar');
  $('buscador-icono-2').innerHTML = icono('buscar');
  try {
    [estado.paradas, estado.lineas, estado.trazados] = await Promise.all([
      pedir('datos/paradas.json'), pedir('datos/lineas.json'), pedir('datos/trazados.json'),
    ]);
  } catch {
    // Sin los datos básicos no hay web: se dice claramente y se ofrece reintentar.
    $('resultado').innerHTML = `<p class="vacio-grande">${t('No hemos podido cargar la web. Puede ser la conexión.')} <button type="button" class="boton-reintentar" id="reintentar">${t('Reintentar')}</button></p>`;
    $('reintentar').addEventListener('click', () => location.reload());
    return;
  }
  if (!estado.paradas[estado.origen]) estado.origen = '71801';
  if (estado.destino && (!estado.paradas[estado.destino] || estado.destino === estado.origen)) estado.destino = '';
  const linea = parametros.get('linea');
  if (linea && estado.lineas[linea]) estado.filtro.add(linea);

  prepararBuscadores();
  prepararFiltro();
  prepararRed();
  prepararHoja();
  $('peores').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-clave]');
    if (b) irAlTren(b.dataset.clave);
  });
  // Desde la burbuja de un tren en el mapa
  $('mapa').addEventListener('click', (e) => {
    const b = e.target.closest('[data-paradas]');
    if (!b) return;
    const [tren, linea] = b.dataset.paradas.split('|');
    abrirHoja({ tren, linea, origen: null, destino: null });
  });
  // Que el desplegable de avisos siga abierto (o cerrado) al repintar cada minuto.
  document.addEventListener('toggle', (e) => {
    if (e.target.matches?.('.avisos-plegados')) estado.avisosAbiertos = e.target.open;
  }, true);
  $('resultado').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tren]');
    if (b) abrirHoja({ tren: b.dataset.tren, linea: b.dataset.linea, origen: estado.origen, destino: estado.destino || null });
  });
  addEventListener('online', () => { pintarAviso(); refrescar(); });
  addEventListener('offline', pintarAviso);

  mostrarVista(estado.vista, { inicial: true });
  // El horario no espera a los datos en directo: si Renfe tarda, se ve igual.
  await cargarHorario();
  pintar();
  cargarLineas();
  await arrancarDirecto();
  pintar();
  if (estado.filtro.size) aplicarFiltro();

  // Los datos llegan solos por la conexión en directo. Por si se corta: cada minuto se comprueba y, si hace
  // rato que no llega nada, se piden. Con la pestaña oculta se cierra la conexión (ni batería ni peticiones).
  setInterval(() => document.visibilityState === 'visible' && refrescar(), CADA);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      conectarDirecto();
      refrescar();
    } else cerrarDirecto();
  });
}

async function refrescar() {
  await cargarHorario();
  if (Date.now() - ultimoMensaje > 90_000) await cargarVivo();
  pintar();
}

// ---------- En directo: el servidor manda lo nuevo a todas las webs abiertas a la vez ----------
let directo = null; // la conexión (WebSocket) con el repetidor
let reintento = 1000; // espera antes de reconectar, que crece si sigue fallando
let ultimoMensaje = 0;

function aplicarVivo(datos) {
  estado.ts = datos.ts;
  estado.vivo = new Map(datos.trenes.map((x) => [`${x[0]}|${x[1]}`, x]));
  estado.posiciones = datos.posiciones ?? [];
  estado.avisos = datos.avisos ?? estado.avisos;
  estado.intentado = true;
}

function conectarDirecto() {
  if (directo || !('WebSocket' in window) || document.visibilityState !== 'visible') return;
  // En local (npm run local) se conecta al de producción, que es el que tiene los datos.
  const local = /^(localhost|127\.)/.test(location.hostname);
  const conexion = new WebSocket(`${local || location.protocol === 'https:' ? 'wss' : 'ws'}://${local ? 'rodalies.reloda.es' : location.host}/api/directo`);
  directo = conexion;
  conexion.addEventListener('message', (e) => {
    try {
      aplicarVivo(JSON.parse(e.data));
    } catch {
      return;
    }
    ultimoMensaje = Date.now();
    reintento = 1000;
    pintar();
    estado.alPrimerDato?.();
  });
  conexion.addEventListener('close', () => {
    if (directo !== conexion) return; // la cerramos nosotros (pestaña oculta)
    directo = null;
    setTimeout(conectarDirecto, reintento);
    reintento = Math.min(reintento * 2, 60_000);
  });
  conexion.addEventListener('error', () => conexion.close());
}

function cerrarDirecto() {
  const conexion = directo;
  directo = null;
  conexion?.close(1000);
}

/** Espera el primer dato por la conexión en directo; si en 4 s no llega, lo pide a /api/vivo. */
function arrancarDirecto() {
  return new Promise((listo) => {
    const espera = setTimeout(async () => {
      estado.alPrimerDato = null;
      await cargarVivo();
      listo();
    }, 4000);
    estado.alPrimerDato = () => {
      clearTimeout(espera);
      estado.alPrimerDato = null;
      listo();
    };
    conectarDirecto();
  });
}

async function pedir(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function cargarHorario() {
  const { dia } = momentoDeServicio();
  if (estado.dia === dia && estado.horario) return;
  try {
    estado.horario = await pedir(`datos/horarios/${dia}.json`);
    estado.dia = dia;
    // Destino y recorrido de cada tren de hoy, para el mapa, las listas y la hoja de paradas.
    estado.destinos = new Map(estado.horario.map(([tren, linea, paradas]) => [`${tren}|${linea}`, paradas.at(-1)[0]]));
    estado.viajes = new Map(estado.horario.map((v) => [`${v[0]}|${v[1]}`, v]));
  } catch {
    estado.horario = null;
  }
}

async function cargarVivo() {
  try {
    aplicarVivo(await pedir('/api/vivo'));
  } catch {
    // Se queda con lo último que tenía; el aviso de datos viejos lo dice.
  }
  estado.intentado = true;
}

function pintar() {
  calcularProblemas();
  pintarViaje();
  pintarAvisosRed();
  pintarAhora();
  pintarPeores();
  pintarFichas();
  pintarCuentasFiltro();
  pintarTrenesEnMapa();
  if (estado.hoja && $('hoja').open) pintarHoja();
  pintarAviso();
}

// ---------- Apartados: Mi viaje, Mapa, Cómo va la red ----------
function prepararVistas() {
  document.querySelectorAll('.vistas button').forEach((b) => {
    b.querySelector('.vistas-icono').innerHTML = icono(b.querySelector('.vistas-icono').dataset.icono);
    b.addEventListener('click', () => mostrarVista(b.dataset.vista));
  });
  addEventListener('popstate', () => {
    const v = new URLSearchParams(location.search).get('vista');
    mostrarVista(VISTAS.includes(v) ? v : 'viaje', { inicial: true });
  });
}

function mostrarVista(vista, { inicial = false } = {}) {
  estado.vista = vista;
  document.querySelectorAll('section.vista').forEach((s) => { s.hidden = s.dataset.vista !== vista; });
  document.querySelectorAll('.vistas button').forEach((b) => {
    if (b.dataset.vista === vista) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.body.dataset.vista = vista;
  if (vista === 'mapa') {
    if (estado.mapa) estado.mapa.mapa.resize();
    else asegurarMapa();
  }
  if (!inicial) {
    scrollTo({ top: 0 });
    actualizarUrl(true);
  }
}

/** El mapa se crea la primera vez que se abre su apartado (así no se carga si no se usa). */
let cargandoMapa = null;
/** La librería del mapa (1 MB) solo se descarga la primera vez que se abre el apartado Mapa. */
function cargarLibreriaMapa() {
  if (window.maplibregl) return Promise.resolve();
  cargandoMapa ??= new Promise((listo, fallo) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/maplibre-gl.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = 'vendor/maplibre-gl.js';
    js.onload = listo;
    js.onerror = fallo;
    document.head.append(js);
  });
  return cargandoMapa;
}

async function asegurarMapa() {
  if (estado.mapa || !estado.trazados) return;
  if (!window.maplibregl) $('mapa').innerHTML = `<p class="mapa-cargando">${t('Cargando el mapa…')}</p>`;
  try {
    await cargarLibreriaMapa();
  } catch {
    cargandoMapa = null; // que se pueda reintentar volviendo a abrir el apartado
    $('mapa').innerHTML = `<p class="mapa-error">${t('No se ha podido cargar el mapa.')}</p>`;
    return;
  }
  if (estado.mapa) return;
  $('mapa').innerHTML = '';
  estado.mapa = crearMapa({
    contenedor: 'mapa',
    oscuro: esOscuro(),
    trazados: estado.trazados,
    paradas: estado.paradas,
    alElegirEstacion: (id) => {
      elegirOrigen(id);
      mostrarVista('viaje');
    },
    alElegirLinea: (linea) => alternarLinea(linea, true),
    contenidoTren,
  });
  // mapa.js guarda los trenes, la estación y el filtro y los pone en cuanto el estilo está listo:
  // no hace falta esperar a que el mapa termine de cargar (eso puede tardar con conexiones lentas).
  estado.mapa.elegirEstacion(estado.origen, false);
  pintarTrenesEnMapa();
  if (estado.filtro.size) estado.mapa.filtrarLineas(estado.filtro);
  if (estado.trenPendiente) {
    estado.mapa.enfocarTren(estado.trenPendiente);
    estado.trenPendiente = null;
  }
}

/** Lleva al mapa y enseña un tren. */
function irAlTren(clave) {
  mostrarVista('mapa');
  if (estado.mapa) estado.mapa.enfocarTren(clave);
  else estado.trenPendiente = clave; // el mapa aún se está descargando: se enseña en cuanto esté
}

/** "a Estació de França" (destino) y dónde está ahora; nunca se confunde una cosa con la otra. */
function destinoDe(tren, linea) {
  const destino = estado.destinos.get(`${tren}|${linea}`);
  return destino ? `a ${corto(destino)}` : `tren ${tren}`;
}

// ---------- Mi viaje ----------
function pintarViaje() {
  const resultado = $('resultado');
  if (!estado.horario) {
    resultado.innerHTML = `<p class="vacio-grande">${t('No hay horarios de hoy cargados. Vuelve a intentarlo en un rato.')}</p>`;
    return;
  }
  const ahora = momentoDeServicio().minutos;
  if (estado.destino) {
    pintarViajes(ahora);
    $('nota-viaje').innerHTML = t('La hora de llegada es la prevista más el retraso que lleva el tren <strong>ahora</strong>. Si todavía no ha llegado a tu estación, puede recuperar o perder algo de tiempo por el camino. Toca un tren para ver todas sus paradas.');
  } else {
    pintarTablero(ahora);
    $('nota-viaje').innerHTML = t('En grande, la hora a la que sale de verdad; si va con retraso, la prevista va debajo, tachada. <strong>Toca un tren</strong> para ver a qué hora pasa por cada parada. Pon una estación en «Hasta» para ver directamente a qué hora llegas.');
  }
  // Avisos de Renfe de las líneas que pasan por tu estación (y por tu destino, si lo hay), encima de todo.
  const lineas = lineasDeEstacion(estado.horario, estado.origen);
  if (estado.destino) {
    const enDestino = lineasDeEstacion(estado.horario, estado.destino);
    for (const l of lineas) if (!enDestino.has(l)) lineas.delete(l);
  }
  $('resultado').insertAdjacentHTML('afterbegin', cajaAvisos(lineas, { plegada: true }));
}

// ---------- Problemas: avisos de Renfe y líneas de las que casi no llegan datos ----------
function calcularProblemas() {
  if (!estado.horario || !estado.ts) return;
  estado.cobertura = cobertura(estado.horario, estado.vivo, momentoDeServicio().minutos);
  estado.sinDatos = new Set(lineasSinDatos(estado.cobertura));
}

const textoAviso = (a) => (idioma === 'ca' && a.ca ? a.ca : a.es);
const fechaAviso = (s) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(s * 1000));

/** Los avisos que tocan alguna de estas líneas, y las líneas que parece que no circulan. '' si no hay nada. */
// Con `plegada`, una sola línea que se abre al tocarla (para no tapar los trenes en Mi viaje y en la hoja).
function cajaAvisos(lineas, { plegada = false } = {}) {
  const avisos = estado.avisos.filter((a) => a.lineas.some((l) => lineas.has(l)));
  const sinDatos = [...lineas].filter((l) => estado.sinDatos.has(l)).sort();
  if (!avisos.length && !sinDatos.length) return '';
  if (plegada) {
    const afectadas = [...new Set([...sinDatos, ...avisos.flatMap((a) => a.lineas.filter((l) => lineas.has(l)))])].sort();
    const n = avisos.length + sinDatos.length;
    return `<details class="avisos-plegados${sinDatos.length ? ' grave' : ''}"${estado.avisosAbiertos ? ' open' : ''}>
      <summary><span class="aviso-signo" aria-hidden="true">!</span><span>${n === 1 ? t('Hay un aviso en tus líneas') : t('{n} avisos en tus líneas', { n })}</span>
        <span class="aviso-lineas">${afectadas.slice(0, 5).map(chip).join('')}</span></summary>
      ${cajaAvisos(lineas)}</details>`;
  }
  const chips = (ls) => (ls.length > 6 ? ls.slice(0, 6).map(chip).join('') + `<span class="mas-lineas">${t('+{n} líneas', { n: ls.length - 6 })}</span>` : ls.map(chip).join(''));
  return `<div class="avisos">${sinDatos.map((l) => {
    const c = estado.cobertura.get(l);
    return `<div class="aviso aviso-grave" role="note"><p class="aviso-cab">${chip(l)}<strong>${t('Puede que la {l} no esté circulando', { l })}</strong></p>
      <p>${t('Ahora deberían circular {b} trenes de esta línea y Renfe solo da datos de {a}.', { a: c.conDatos, b: c.previstos })}</p></div>`;
  }).join('')}${avisos.map((a) => `<div class="aviso" role="note">
      <p class="aviso-cab"><span class="aviso-signo" aria-hidden="true">!</span><strong>${t('Aviso de Renfe')}</strong>${chips(a.lineas)}</p>
      <p>${escapar(textoAviso(a))}</p>
      ${a.inicio ? `<p class="aviso-fecha">${t('Desde {f}', { f: fechaAviso(a.inicio) })}</p>` : ''}</div>`).join('')}</div>`;
}

function pintarAvisosRed() {
  const todas = new Set([...estado.avisos.flatMap((a) => a.lineas), ...estado.sinDatos]);
  $('avisos-red').innerHTML = `<h2 class="bloque-titulo">${t('Avisos de Renfe ahora')}</h2>` +
    (todas.size ? cajaAvisos(todas) : `<p class="sin-avisos">${t('Renfe no tiene avisos activos en Rodalies ahora mismo.')}</p>`);
}

const escapar = (texto) => String(texto ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function pintarViajes(ahora) {
  const viajes = proximosViajes(estado.horario, estado.origen, estado.destino, ahora, estado.vivo);
  const cab = `<div class="viajes-cab"><h2>De <strong>${corto(estado.origen)}</strong> a <strong>${corto(estado.destino)}</strong></h2></div>`;
  if (!viajes.length) {
    $('resultado').innerHTML = `${cab}<p class="vacio-grande">${t('No hay trenes directos de {o} a {d} en las próximas 3 horas. Puede que haya que hacer transbordo.', { o: corto(estado.origen), d: corto(estado.destino) })}</p>`;
    return;
  }
  $('resultado').innerHTML = cab + `<ol class="viajes">${viajes.map((v) => {
    const tarde = v.retraso > 0 && v.estado !== 'cancelado';
    const cancelado = v.estado === 'cancelado';
    return `<li><button type="button" class="viaje${cancelado ? ' cancelado' : ''}" data-tren="${v.tren}" data-linea="${v.linea}"
        aria-label="${t('Tren {linea} {destino}: sale a las {sale} y llega a las {llega}. {estado}', { linea: v.linea, destino: destinoDe(v.tren, v.linea), sale: aHora(v.saleEstimada), llega: aHora(v.llegaEstimada), estado: frase(v.estado, v.retraso, v.linea) })}">
      <span class="viaje-linea">${chip(v.linea)}<span>${destinoDe(v.tren, v.linea)}</span></span>
      <span class="viaje-horas">
        <span class="viaje-hora"><small>${t('Sale')}</small><b>${aHora(v.saleEstimada)}</b>${tarde ? `<s>${aHora(v.sale)}</s>` : ''}</span>
        <span class="viaje-flecha" aria-hidden="true">→</span>
        <span class="viaje-hora llega"><small>${t('Llegas')}</small><b>${aHora(v.llegaEstimada)}</b>${tarde ? `<s>${aHora(v.llega)}</s>` : ''}</span>
      </span>
      <span class="viaje-estado ${claseEstado(v.estado, v.retraso)}">${frase(v.estado, v.retraso, v.linea)}</span>
      <span class="viaje-extra">${cancelado ? '' : `${enCuanto(v.saleEstimada - ahora)} · ${t('{n} min de viaje', { n: v.duracion })} · `}<span class="ver-paradas">${t('Ver paradas ›')}</span></span>
    </button></li>`;
  }).join('')}</ol>`;
}

function pintarTablero(ahora) {
  const salidas = proximasSalidas(estado.horario, estado.origen, ahora, estado.vivo);
  const barra = `<div class="tablero-barra"><span class="tablero-salidas">${t('Salidas')}</span><strong class="tablero-estacion">${nombre(estado.origen)}</strong></div>`;
  if (!salidas.length) {
    $('resultado').innerHTML = `<div class="tablero">${barra}<p class="tablero-vacio">${t('No salen trenes de esta estación en las próximas dos horas.')}</p></div>`;
    return;
  }
  // Solo giran las filas que ya estaban y han cambiado (no al cargar ni al cambiar de estación).
  const misma = estado.previo.clave === estado.origen;
  const filas = new Map();
  $('resultado').innerHTML = `<div class="tablero">${barra}<div class="tablero-cab" aria-hidden="true"><span>${t('Sale')}</span><span>${t('Línea')}</span><span>${t('Destino')}</span><span>${t('Estado')}</span></div>` + salidas.map((s) => {
    const enMin = s.estimada - ahora;
    const cuando = enMin <= 0 ? t('saliendo') : enMin < 60 ? `en ${enMin} min` : `en ${Math.floor(enMin / 60)} h ${enMin % 60} min`;
    // En grande, siempre la hora a la que sale de verdad; si no es la prevista, la prevista va debajo, tachada.
    const conRetraso = s.retraso > 0 && s.estado !== 'cancelado';
    const textoEstado = {
      cancelado: `<span class="estado-cancelado">${t('Cancelado')}</span>`,
      bus: `<span class="estado-bus">${t('Autobús')}</span><small>${cuando}</small>`,
      retraso: `<span class="estado-retraso${s.retraso >= MUY_TARDE ? ' mucho' : ''}">+${s.retraso} min</span><small>${cuando}</small>`,
      leve: `<span class="estado-leve">+${s.retraso} min</span><small>${cuando}</small>`,
      hora: `<span class="estado-hora">${t('A su hora')}</span><small>${cuando}</small>`,
      'sin-salir': `<span class="estado-sin">${t('Aún no ha salido')}</span><small>${cuando}</small>`,
      'sin-datos': `<span class="estado-sin">${estado.sinDatos.has(s.linea) ? t('Puede que no circule') : t('Sin seguimiento')}</span><small>${cuando}</small>`,
    }[s.estado];
    const clave = `${s.tren}|${s.linea}`;
    const firma = `${s.estado}|${s.retraso}`;
    filas.set(clave, firma);
    const cambia = misma && estado.previo.filas.has(clave) && estado.previo.filas.get(clave) !== firma;
    const clases = ['salida', s.estado === 'cancelado' ? 'cancelado' : '', s.estado === 'retraso' ? 'tarde' : '', cambia ? 'cambia' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${clases}" style="--color:#${colorDe(s.linea)}" data-tren="${s.tren}" data-linea="${s.linea}"
        aria-label="${t('{linea} a {destino}, sale a las {hora}. {estado}. Ver paradas', { linea: s.linea, destino: corto(s.destino), hora: aHora(s.estimada), estado: frase(s.estado, s.retraso, s.linea) })}">
      <span class="salida-hora">${conRetraso ? aHora(s.estimada) : s.hora}${conRetraso ? `<s>${s.hora}</s>` : ''}</span>
      ${chip(s.linea)}
      <span class="salida-destino"><strong>${corto(s.destino)}</strong><span>${s.estado === 'bus' ? t('Servicio alternativo por carretera') : t('Tren {n} · ver paradas', { n: s.tren })}</span></span>
      <span class="salida-estado">${textoEstado}</span>
    </button>`;
  }).join('') + '</div>';
  estado.previo = { clave: estado.origen, filas };
}

// ---------- Hoja con las paradas de un tren (estilo ADIF) ----------
function prepararHoja() {
  const hoja = $('hoja');
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja || e.target.closest('[data-cerrar-hoja]')) hoja.close();
    const mapa = e.target.closest('[data-ver-mapa]');
    if (mapa) {
      hoja.close();
      irAlTren(mapa.dataset.verMapa);
    }
  });
  hoja.addEventListener('close', () => { estado.hoja = null; });
}

function abrirHoja(datos) {
  estado.hoja = datos;
  pintarHoja();
  $('hoja').showModal();
  // Que se vea la parada donde subes (o la actual), no la primera del recorrido.
  const foco = $('hoja').querySelector('.parada.origen') ?? $('hoja').querySelector('.parada.actual');
  foco?.scrollIntoView({ block: 'center' });
}

function pintarHoja() {
  const { tren, linea, origen, destino } = estado.hoja;
  const clave = `${tren}|${linea}`;
  const viaje = estado.viajes.get(clave);
  if (!viaje) return;
  const ahora = momentoDeServicio().minutos;
  const { estado: e, retraso } = estadoDe(viaje, ahora, estado.vivo);
  const paradas = recorrido(viaje, estado.vivo);
  const actual = paradas.find((p) => p.actual);
  const conGps = estado.posiciones.some(([t, l]) => `${t}|${l}` === clave);
  const iOrigen = paradas.findIndex((p) => p.parada === origen);
  const iDestino = destino ? paradas.findIndex((p, k) => k > iOrigen && p.parada === destino) : -1;
  $('hoja').innerHTML = `
    <div class="hoja-cab">
      ${chip(linea)}
      <div><h2 id="hoja-titulo">Tren ${destinoDe(tren, linea)}</h2><p>Tren ${tren}${e === 'bus' ? t(' · servicio por carretera') : ''}</p></div>
      <button type="button" class="hoja-cerrar" data-cerrar-hoja>${t('Cerrar')}</button>
    </div>
    <p class="hoja-estado ${claseEstado(e, retraso)}">${frase(e, retraso, linea)}${actual ? `<span>${t('Ahora por <strong>{p}</strong>', { p: corto(actual.parada) })}</span>` : ''}</p>
    ${cajaAvisos(new Set([linea]), { plegada: true })}
    ${conGps ? `<button type="button" class="boton-secundario" data-ver-mapa="${clave}">${icono('mapa')}${t('Ver dónde está en el mapa')}</button>` : ''}
    <ol class="paradas">${paradas.map((p, k) => {
      const clases = ['parada', p.pasada ? 'pasada' : '', p.actual ? 'actual' : '', k === iOrigen ? 'origen' : '', k === iDestino ? 'destino' : '',
        iDestino > -1 && k > iOrigen && k < iDestino ? 'en-tramo' : ''].filter(Boolean).join(' ');
      const tarde = retraso > 0 && !p.pasada && e !== 'cancelado';
      const marca = p.actual ? `<em class="marca-actual">${t('Ahora por aquí')}</em>` : k === iOrigen ? `<em>${t('Subes aquí')}</em>` : k === iDestino ? `<em>${t('Bajas aquí')}</em>` : '';
      return `<li class="${clases}">
        <span class="parada-hora"><b>${aHora(tarde ? p.estimada : p.minutos)}</b>${tarde ? `<s>${p.hora}</s>` : ''}</span>
        <span class="parada-punto" aria-hidden="true"></span>
        <span class="parada-nombre">${nombre(p.parada)}${marca}</span>
      </li>`;
    }).join('')}</ol>
    <p class="hoja-nota">${retraso > 0 ? t('Las horas en grande suman los {n} min de retraso que lleva ahora. ', { n: retraso }) : ''}${t('Las paradas en gris ya las ha pasado.')}</p>`;
}

// ---------- Reloj y aviso de datos viejos ----------
function prepararReloj() {
  const formato = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const tic = () => {
    $('reloj').textContent = formato.format(new Date());
    if (!estado.ts) return;
    const hace = Math.max(0, Math.round(Date.now() / 1000 - estado.ts));
    $('frescura').textContent = t('Datos de hace {t}', { t: hace < 90 ? `${hace} s` : `${minutos(hace)} min` });
    $('frescura').classList.toggle('viejo', hace > VIEJO);
    if (hace > VIEJO !== document.body.classList.contains('datos-viejos')) pintarAviso();
  };
  tic();
  setInterval(tic, 1000);
}

function pintarAviso() {
  const hace = estado.ts ? Math.round(Date.now() / 1000 - estado.ts) : 0;
  const sinRed = !navigator.onLine;
  const viejo = sinRed || hace > VIEJO;
  document.body.classList.toggle('datos-viejos', viejo);
  $('aviso-datos').hidden = !viejo;
  if (viejo) {
    $('aviso-datos').textContent = sinRed
      ? t('Sin conexión: lo que ves es de hace {n} min.', { n: minutos(hace) })
      : t('Renfe no da datos nuevos desde hace {n} min: lo que ves puede haber cambiado.', { n: minutos(hace) });
  }
}

// ---------- Cómo va la red ----------
function pintarAhora() {
  if (!estado.ts && !estado.intentado) return; // aún cargando: se queda el "Cargando los trenes…"
  if (!estado.ts) {
    $('titular').textContent = t('No hay datos de Renfe ahora mismo');
    $('ahora-texto').innerHTML = `${t('Vuelve a intentarlo en unos minutos.')} <button type="button" class="boton-reintentar" id="reintentar">${t('Reintentar')}</button>`;
    $('reintentar').addEventListener('click', refrescar);
    return;
  }
  const r = resumenAhora([...estado.vivo.values()], UMBRAL);
  const parte = r.total ? r.conRetraso / r.total : 0;
  $('titular').innerHTML = r.conRetraso === 0
    ? t('Ahora mismo Rodalies va <em class="bien">a su hora</em>')
    : parte < 0.15
      ? t('Ahora mismo van tarde <em>{a} de {b}</em> trenes', { a: r.conRetraso, b: r.total })
      : t('Ahora mismo, <em>{p} %</em> de los trenes van tarde', { p: numero(parte * 100) });
  pintarRed();
  $('ahora-texto').innerHTML = r.peor && r.peor[2] >= UMBRAL
    ? t('«Tarde» es {t} minutos o más. El que más, un {chip} {destino}, con <strong>{n} minutos</strong>{donde}.', {
      t: TARDE, chip: chip(r.peor[1]), destino: destinoDe(r.peor[0], r.peor[1]), n: minutos(r.peor[2]),
      donde: r.peor[3] ? t(' (ahora cerca de {p})', { p: corto(r.peor[3]) }) : '',
    })
    : t('Ningún tren lleva {t} minutos o más de retraso.', { t: TARDE });
}

// La red ahora: una raya por tren
let rayas = [];
function tipoDe(t) {
  return t[4] ? 'tc' : t[2] >= MUY_TARDE * 60 ? 't2' : t[2] >= UMBRAL ? 't1' : 't0';
}
function pintarRed() {
  const orden = { t0: 0, t1: 1, t2: 2, tc: 3 };
  rayas = [...estado.vivo.values()].filter((t) => t[4] || t[2] !== null)
    .sort((a, b) => orden[tipoDe(a)] - orden[tipoDe(b)] || (a[2] ?? 0) - (b[2] ?? 0));
  const cuenta = { t0: 0, t1: 0, t2: 0, tc: 0 };
  for (const t of rayas) cuenta[tipoDe(t)]++;
  $('red-total').textContent = t('{n} trenes', { n: rayas.length });
  $('red-barras').setAttribute('aria-label', t('{a} a su hora, {b} con {t} a {m} minutos de retraso, {c} con {mt} o más, {d} cancelados. Usa las flechas para recorrerlos.', { a: cuenta.t0, b: cuenta.t1, t: TARDE, m: MUY_TARDE - 1, c: cuenta.t2, mt: MUY_TARDE, d: cuenta.tc }));
  $('red-barras').innerHTML = rayas.map((t, i) => `<span class="${tipoDe(t)}" data-i="${i}"></span>`).join('');
  const clave = (c, color, texto) => `<span><i style="background:var(${color})"></i><strong>${cuenta[c]}</strong> ${texto}</span>`;
  $('red-leyenda').innerHTML = clave('t0', '--neutro', t('a su hora o casi')) + clave('t1', '--tarde', `${TARDE}–${MUY_TARDE - 1} min`) +
    clave('t2', '--muy-tarde', t('{n} o más', { n: MUY_TARDE })) + (cuenta.tc ? clave('tc', '--tinta', cuenta.tc === 1 ? t('cancelado') : t('cancelados')) : '');
}

// Tocar o arrastrar el dedo por la raya dice qué tren es; soltar lo enseña en el mapa. Con teclado, flechas + Intro.
function prepararRed() {
  const barra = $('red-barras');
  let elegida = -1;
  const decir = (i) => {
    const t = rayas[i];
    if (!t) return;
    elegida = i;
    barra.querySelectorAll('.activa').forEach((x) => x.classList.remove('activa'));
    barra.children[i]?.classList.add('activa');
    const estadoTren = t[4] ? tr('cancelado') : t[2] >= 60 ? `+${minutos(t[2])} min` : tr('a su hora');
    $('red-lectura').innerHTML = `${chip(t[1])} <span>${destinoDe(t[0], t[1])}</span><strong>${estadoTren}</strong>`;
  };
  const indice = (x) => {
    const r = barra.getBoundingClientRect();
    return Math.max(0, Math.min(rayas.length - 1, Math.floor(((x - r.left) / r.width) * rayas.length)));
  };
  const ensenar = () => {
    const t = rayas[elegida];
    if (t && estado.posiciones.some(([tr, l]) => tr === t[0] && l === t[1])) irAlTren(`${t[0]}|${t[1]}`);
  };
  barra.addEventListener('pointerdown', (e) => { barra.setPointerCapture(e.pointerId); decir(indice(e.clientX)); });
  barra.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') decir(indice(e.clientX)); });
  barra.addEventListener('pointerup', ensenar);
  barra.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      decir(Math.max(0, Math.min(rayas.length - 1, (elegida < 0 ? 0 : elegida + (e.key === 'ArrowRight' ? 1 : -1)))));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ensenar();
    }
  });
}

// Los cinco que más retraso llevan ahora; al tocarlos, el mapa vuela a ellos.
function pintarPeores() {
  const gps = new Map(estado.posiciones.map(([tren, linea, , , , parada]) => [`${tren}|${linea}`, parada]));
  const peores = [...estado.vivo.values()]
    .filter((t) => !t[4] && t[2] !== null && t[2] >= UMBRAL)
    .sort((a, b) => b[2] - a[2])
    .slice(0, 5);
  $('peores').innerHTML = peores.length
    ? peores.map(([tren, linea, retraso, paradaRt]) => {
        const clave = `${tren}|${linea}`;
        const parada = gps.get(clave) || paradaRt;
        const etiqueta = t('{linea} {destino}, {n} minutos de retraso', { linea, destino: destinoDe(tren, linea), n: minutos(retraso) }) + (parada ? t(', cerca de {p}', { p: corto(parada) }) : '');
        return `<li><button type="button" data-clave="${clave}" aria-label="${etiqueta}" ${gps.has(clave) ? '' : `disabled title="${t('Sin posición GPS ahora mismo')}"`}>
          <span class="peor-retraso${retraso >= MUY_TARDE * 60 ? ' mucho' : ''}">+${minutos(retraso)}′</span>${chip(linea)}
          <span class="peor-destino">${destinoDe(tren, linea)}<small>${parada ? t('ahora cerca de {p}', { p: corto(parada) }) : ''}</small></span></button></li>`;
      }).join('')
    : `<li class="peores-vacio">${t('Ningún tren lleva {t} minutos o más de retraso.', { t: TARDE })}</li>`;
}

// ---------- Mapa ----------
function pintarTrenesEnMapa() {
  if (!estado.mapa) return;
  estado.mapa.actualizarTrenes(estado.posiciones.map(([tren, linea, lat, lon, situacion, parada]) => {
    const clave = `${tren}|${linea}`;
    const real = estado.vivo.get(clave);
    return {
      clave, lat, lon,
      props: {
        tren, linea, situacion, color: `#${colorDe(linea)}`,
        retraso: real && real[2] !== null ? Math.max(0, minutos(real[2])) : 0,
        cancelado: Boolean(real?.[4]),
        parada: parada ?? real?.[3] ?? '',
        destino: estado.destinos.get(clave) ?? '',
      },
    };
  }));
}

function contenidoTren(p) {
  const situacion = t({ P: 'Parado en', L: 'Llegando a', C: 'Hacia' }[p.situacion] ?? 'Hacia');
  const retraso = p.cancelado
    ? `<span class="estado-cancelado">${t('Cancelado')}</span>`
    : p.retraso >= TARDE
      ? `<span class="estado-retraso${p.retraso >= MUY_TARDE ? ' mucho' : ''}">${t('+{n} min de retraso', { n: p.retraso })}</span>`
      : `<span class="estado-hora">${t('A su hora')}${p.retraso ? ` (+${p.retraso} min)` : ''}</span>`;
  return `<div class="tren-emergente">
    <div class="tren-cab">${chip(p.linea)}<strong>${p.destino ? `a ${corto(p.destino)}` : `Tren ${p.tren}`}</strong></div>
    <p>${retraso}</p>
    ${p.parada ? `<p class="tren-donde">${situacion} ${corto(p.parada)}</p>` : ''}
    <p class="tren-numero">Tren ${p.tren}</p>
    ${estado.viajes.has(`${p.tren}|${p.linea}`) ? `<button type="button" class="enlace ver-paradas-mapa" data-paradas="${p.tren}|${p.linea}">${t('Ver a qué hora pasa por cada parada')}</button>` : ''}
  </div>`;
}

function prepararFiltro() {
  const presentes = Object.keys(estado.lineas).filter((l) => estado.trazados.features.some((f) => f.properties.linea === l));
  const clave = (l) => [/^R\d/.test(l) ? 0 : 1, Number(l.replace(/\D/g, '')) || 0, l];
  presentes.sort((a, b) => {
    const [x, y] = [clave(a), clave(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
  });
  const caja = $('filtro-lineas');
  caja.innerHTML = `<button type="button" class="filtro-todas" aria-pressed="true">${t('Todas')}</button>` +
    presentes.map((l) => `<button type="button" data-linea="${l}" aria-pressed="false" style="--color:#${colorDe(l)};--texto:${textoSobre(colorDe(l))}">${l}</button>`).join('');
  caja.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('filtro-todas')) {
      estado.filtro.clear();
      aplicarFiltro();
    } else alternarLinea(b.dataset.linea);
  });
  $('fichas-linea').addEventListener('click', (e) => {
    const cerrar = e.target.closest('[data-cerrar]');
    if (cerrar) return alternarLinea(cerrar.dataset.cerrar);
    const mas = e.target.closest('[data-mas]');
    if (mas) {
      estado.fichasAbiertas.add(mas.dataset.mas);
      return pintarFichas();
    }
    const tren = e.target.closest('[data-clave]');
    if (tren) {
      irAlTren(tren.dataset.clave);
      $('mapa').scrollIntoView({ behavior: quieto() ? 'auto' : 'smooth', block: 'center' });
    }
  });
}

/** Elige o quita una línea; con `sola`, deja solo esa (al tocar su trazado en el mapa). */
function alternarLinea(linea, sola = false) {
  if (sola) {
    const yaEraLaUnica = estado.filtro.size === 1 && estado.filtro.has(linea);
    estado.filtro.clear();
    if (!yaEraLaUnica) estado.filtro.add(linea);
  } else if (estado.filtro.has(linea)) estado.filtro.delete(linea);
  else estado.filtro.add(linea);
  aplicarFiltro();
}

// Cuántos trenes de cada línea circulan ahora, en su botón.
function pintarCuentasFiltro() {
  const cuenta = new Map();
  for (const t of estado.vivo.values()) if (!t[4] && t[2] !== null) cuenta.set(t[1], (cuenta.get(t[1]) ?? 0) + 1);
  $('filtro-lineas').querySelectorAll('[data-linea]').forEach((b) => {
    const n = cuenta.get(b.dataset.linea) ?? 0;
    b.innerHTML = `${b.dataset.linea}<small aria-hidden="true">${n}</small>`;
    b.dataset.n = n;
    const trenes = n === 1 ? t('tren') : t('trenes');
    b.setAttribute('aria-label', t('{l}, {n} {trenes} ahora', { l: b.dataset.linea, n, trenes }));
    b.title = t('{nombre}: {n} {trenes} ahora', { nombre: estado.lineas[b.dataset.linea]?.nombre ?? b.dataset.linea, n, trenes });
  });
}

function aplicarFiltro() {
  const caja = $('filtro-lineas');
  caja.querySelector('.filtro-todas').setAttribute('aria-pressed', String(!estado.filtro.size));
  caja.querySelectorAll('[data-linea]').forEach((x) => x.setAttribute('aria-pressed', String(estado.filtro.has(x.dataset.linea))));
  estado.mapa?.filtrarLineas(estado.filtro);
  actualizarUrl();
  pintarFichas();
}

// Ficha de cada línea elegida: recorrido, trenes de ahora y puntualidad desde que hay datos.
function pintarFichas() {
  const conPosicion = new Set(estado.posiciones.map(([tren, linea]) => `${tren}|${linea}`));
  $('fichas-linea').innerHTML = [...estado.filtro].slice(0, 3).map((linea) => {
    const trenes = [...estado.vivo.values()].filter((t) => t[1] === linea).sort((a, b) => (b[2] ?? -1) - (a[2] ?? -1));
    const enMarcha = trenes.filter((t) => !t[4] && t[2] !== null);
    const tarde = enMarcha.filter((t) => t[2] >= UMBRAL).length;
    const p = estado.puntualidad.get(linea);
    const historico = p
      ? `<span>${t('Desde el {f}: <strong>{p} %</strong> puntuales · retraso medio <strong>{m} min</strong>', { f: fechaCorta(estado.desde ?? p.primera_fecha), p: numero((p.puntuales / p.con_dato) * 100), m: numero((p.retraso_medio ?? 0) / 60, 1) })}</span>`
      : '';
    const MAXIMO = 6;
    const visibles = estado.fichasAbiertas.has(linea) ? trenes : trenes.slice(0, MAXIMO);
    const resto = trenes.length - visibles.length;
    const lista = visibles.map((t) => {
      const clave = `${t[0]}|${t[1]}`;
      const [texto, clase] = t[4] ? [tr('Cancel.'), 'estado-cancelado']
        : t[2] >= MUY_TARDE * 60 ? [`+${minutos(t[2])}′`, 'estado-cancelado']
          : t[2] >= UMBRAL ? [`+${minutos(t[2])}′`, 'estado-retraso']
            : [tr('A su hora'), 'estado-hora'];
      return `<li><button type="button" data-clave="${clave}" aria-label="${destinoDe(t[0], t[1])}, ${texto}" ${conPosicion.has(clave) ? '' : 'disabled'}><span class="ficha-retraso ${clase}">${texto}</span><span class="ficha-destino">${destinoDe(t[0], t[1])}</span></button></li>`;
    }).join('');
    return `<article class="ficha-linea" style="--color:#${colorDe(linea)}">
      <div class="ficha-cab">${chip(linea)}<h3>${estado.lineas[linea]?.nombre ?? t('Línea {l}', { l: linea })}</h3>
        <button type="button" class="boton-cerrar" data-cerrar="${linea}" aria-label="${t('Quitar la línea {l}', { l: linea })}" title="${t('Quitar')}">${icono('cerrar')}</button></div>
      <p class="ficha-datos"><span>${t('Ahora: <strong>{n} {trenes}</strong>', { n: enMarcha.length, trenes: enMarcha.length === 1 ? t('tren') : t('trenes') })}${enMarcha.length ? t(', {n} con {t} min o más', { n: tarde, t: TARDE }) : ''}</span>${historico}</p>
      ${cajaAvisos(new Set([linea]))}
      ${lista ? `<ul class="ficha-trenes">${lista}</ul>` : `<p class="ficha-vacia">${t('No circula ningún tren de esta línea ahora mismo.')}</p>`}
      ${resto > 0 ? `<button type="button" class="enlace ficha-mas" data-mas="${linea}">${t('Ver los otros {n} trenes', { n: resto })}</button>` : ''}
    </article>`;
  }).join('');
}

// ---------- Origen y destino ----------
function elegirOrigen(id) {
  estado.origen = id;
  estado.propia = true;
  if (estado.destino === id) estado.destino = '';
  guardar('estacion', id);
  guardar('recientes', JSON.stringify([id, ...recientes().filter((x) => x !== id)].slice(0, 4)));
  despuesDeElegir();
  estado.mapa?.elegirEstacion(id, false);
}

function elegirDestino(id) {
  estado.destino = id === estado.origen ? '' : id;
  guardar('destino', estado.destino);
  despuesDeElegir();
}

function despuesDeElegir() {
  $('estacion').value = nombre(estado.origen);
  $('destino').value = estado.destino ? nombre(estado.destino) : '';
  $('borrar-destino').hidden = !estado.destino;
  actualizarUrl();
  pintarAtajos();
  pintarViaje();
}

function actualizarUrl(empujar = false) {
  const p = new URLSearchParams();
  if (estado.vista !== 'viaje') p.set('vista', estado.vista);
  if (estado.origen !== '71801') p.set('desde', estado.origen);
  if (estado.destino) p.set('hasta', estado.destino);
  if (estado.filtro.size === 1) p.set('linea', [...estado.filtro][0]);
  const url = p.size ? `?${p}` : location.pathname;
  if (empujar) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

function prepararBuscadores() {
  crearBuscador({ entrada: $('estacion'), lista: $('estaciones-lista'), prefijo: 'o', valor: () => estado.origen, alElegir: elegirOrigen });
  crearBuscador({ entrada: $('destino'), lista: $('destinos-lista'), prefijo: 'd', valor: () => estado.destino, alElegir: elegirDestino });
  $('borrar-destino').addEventListener('click', () => elegirDestino(''));
  $('intercambiar').addEventListener('click', () => {
    if (!estado.destino) return $('destino').focus();
    const [o, d] = [estado.destino, estado.origen];
    estado.destino = d;
    guardar('destino', d);
    elegirOrigen(o);
  });
  $('atajos').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.id) return elegirOrigen(b.dataset.id);
    if (b.dataset.cerca !== undefined) cercaDeMi(b);
  });
  despuesDeElegir();
}

// Buscador propio (no <datalist>): sin tildes ni mayúsculas, por partes y con aviso si no hay nada.
function crearBuscador({ entrada, lista, prefijo, valor, alElegir }) {
  let opciones = [];
  let activa = -1;
  const cerrar = () => {
    lista.hidden = true;
    entrada.setAttribute('aria-expanded', 'false');
    entrada.removeAttribute('aria-activedescendant');
  };
  const marcar = (i) => {
    activa = i;
    lista.querySelectorAll('[role=option]').forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) entrada.setAttribute('aria-activedescendant', `${prefijo}-opcion-${i}`);
  };
  const mostrar = () => {
    const texto = entrada.value.trim();
    opciones = texto ? buscarEstaciones(estado.paradas, texto) : [];
    lista.innerHTML = opciones.length
      ? opciones.map((o, i) => `<li role="option" id="${prefijo}-opcion-${i}" data-id="${o.id}" aria-selected="false">${o.nombre}</li>`).join('')
      : texto ? `<li class="sin-resultados">${t('No encontramos «{t}». Prueba con otra parte del nombre.', { t: texto.replace(/[<>&]/g, '') })}</li>` : '';
    lista.hidden = !texto;
    entrada.setAttribute('aria-expanded', String(!lista.hidden));
    marcar(opciones.length ? 0 : -1);
  };
  const elegir = (id) => {
    cerrar();
    alElegir(id);
    entrada.blur();
  };
  entrada.addEventListener('focus', () => entrada.select());
  entrada.addEventListener('input', mostrar);
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (lista.hidden) mostrar();
      if (opciones.length) marcar((activa + (e.key === 'ArrowDown' ? 1 : -1) + opciones.length) % opciones.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (opciones[activa]) elegir(opciones[activa].id);
    } else if (e.key === 'Escape') {
      cerrar();
      entrada.value = valor() ? nombre(valor()) : '';
    }
  });
  lista.addEventListener('pointerdown', (e) => e.preventDefault()); // que no se pierda el foco antes del clic
  lista.addEventListener('click', (e) => {
    const li = e.target.closest('[data-id]');
    if (li) elegir(li.dataset.id);
  });
  // Al salir sin elegir, el campo vuelve a decir la estación que de verdad se está viendo.
  entrada.addEventListener('blur', () => {
    cerrar();
    entrada.value = valor() ? nombre(valor()) : '';
  });
}

function cercaDeMi(boton) {
  if (!navigator.geolocation) return;
  boton.textContent = t('Buscando…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const cerca = estacionMasCercana(estado.paradas, coords.latitude, coords.longitude);
      if (cerca) elegirOrigen(cerca.id);
      else pintarAtajos();
    },
    () => {
      boton.textContent = t('No se pudo ubicar');
      setTimeout(pintarAtajos, 2500);
    },
    { timeout: 10_000, maximumAge: 300_000 }
  );
}

function pintarAtajos() {
  const ids = [...new Set([...recientes().filter((id) => estado.paradas[id]), ...ATAJOS])].slice(0, 6);
  $('atajos').innerHTML = ('geolocation' in navigator ? `<button type="button" data-cerca class="atajo-cerca">${t('Cerca de mí')}</button>` : '') +
    ids.map((id) => `<button type="button" data-id="${id}" aria-pressed="${id === estado.origen}">${corto(id)}</button>`).join('');
}

// ---------- Líneas ----------
async function cargarLineas() {
  let datos;
  try {
    datos = await pedir('/api/lineas?dias=7&v=2'); // v: para saltarse respuestas antiguas en caché
  } catch {
    $('lineas-sub').innerHTML = `${t('No se han podido cargar los datos de las líneas.')} <button type="button" class="boton-reintentar" id="reintentar-lineas">${t('Reintentar')}</button>`;
    $('reintentar-lineas').addEventListener('click', cargarLineas);
    return;
  }
  const lineas = datos.lineas.filter((l) => l.con_dato >= 3);
  estado.puntualidad = new Map(lineas.map((l) => [l.linea, l]));
  estado.desde = lineas.reduce((a, l) => (!a || l.primera_fecha < a ? l.primera_fecha : a), null);
  pintarFichas();
  const desde = estado.desde;
  $('lineas-sub').textContent = desde
    ? t('Porcentaje de trenes que llegaron con menos de {t} minutos de retraso desde el {f}{extra}. Se actualiza cada hora.', {
      t: TARDE, f: fechaCorta(desde),
      extra: desde === '2026-10-20' ? t(', el día en que esta web empezó a guardar datos. Con tan pocos días, los porcentajes aún pueden cambiar mucho') : '',
    })
    : t('Todavía no hay datos suficientes: el resumen se calcula cada hora.');
  if (!lineas.length) {
    $('tabla-lineas').innerHTML = '';
    return;
  }
  const filas = lineas.map((l) => ({ ...l, pct: l.puntuales / l.con_dato })).sort((a, b) => a.pct - b.pct);
  const tono = (p) => (p >= 0.9 ? 'bien' : p >= 0.75 ? 'medio' : 'mal');
  $('tabla-lineas').innerHTML = `<ol class="ranking">${filas.map((l) => `
      <li class="puesto" style="--color:#${colorDe(l.linea)}">
        ${chip(l.linea)}
        <span class="puesto-pct ${tono(l.pct)}">${numero(l.pct * 100)}<small>%</small></span>
        <div class="puesto-cuerpo">
          <span class="puesto-nombre">${estado.lineas[l.linea]?.nombre ?? ''}</span>
          <div class="puesto-barra" role="img" aria-label="${t('{p} % de trenes puntuales', { p: numero(l.pct * 100) })}">
            <span style="width:${(l.pct * 100).toFixed(1)}%"></span><i style="left:75%"></i><i style="left:90%"></i>
          </div>
        </div>
        <span class="puesto-datos">${t('<strong>{a} de {b}</strong> puntuales<br>{m} min de media{c}', { a: l.puntuales, b: l.con_dato, m: numero((l.retraso_medio ?? 0) / 60, 1), c: l.cancelados ? ` · ${l.cancelados} cancel.` : '' })}</span>
      </li>`).join('')}</ol>
    <p class="ranking-escala"><span>${t('Las rayitas marcan el 75 % y el 90 %.')}</span></p>`;
}

// ---------- Idioma: castellano en /, catalán en /ca/ ----------
function prepararIdiomas() {
  document.querySelectorAll('.idiomas a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      guardar('idioma', a.dataset.idioma); // se recuerda para la próxima vez
      location.href = a.getAttribute('href') + location.search; // misma estación, destino y apartado
    });
  });
}

// ---------- Sugerencias ----------
function prepararSugerencias() {
  const dialogo = $('dialogo-sugerencia');
  const form = $('form-sugerencia');
  const aviso = $('sugerencia-estado');
  $('abrir-sugerencia').addEventListener('click', () => {
    aviso.textContent = '';
    aviso.className = 'sugerencia-estado';
    dialogo.showModal();
    $('sugerencia-texto').focus();
  });
  dialogo.addEventListener('click', (e) => {
    if (e.target === dialogo || e.target.closest('[data-cerrar-sugerencia]')) dialogo.close();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));
    if (datos.texto.trim().length < 5) {
      aviso.textContent = t('Escribe un poco más, por favor.');
      aviso.className = 'sugerencia-estado mal';
      return;
    }
    const boton = form.querySelector('.boton-enviar');
    boton.disabled = true;
    aviso.textContent = t('Enviando…');
    aviso.className = 'sugerencia-estado';
    try {
      const r = await fetch('/api/sugerencia', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...datos, origen: estado.vista }), signal: AbortSignal.timeout(12_000),
      });
      const respuesta = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(respuesta.error || t('No se ha podido enviar.'));
      form.reset();
      aviso.textContent = t('¡Gracias! La hemos recibido.');
      aviso.className = 'sugerencia-estado bien';
      setTimeout(() => dialogo.open && dialogo.close(), 2200);
    } catch (error) {
      aviso.textContent = t('{e} Inténtalo de nuevo en un rato.', { e: error.message });
      aviso.className = 'sugerencia-estado mal';
    } finally {
      boton.disabled = false;
    }
  });
}

// ---------- Modo claro / oscuro ----------
function prepararTema() {
  const boton = $('boton-tema');
  const sistema = matchMedia('(prefers-color-scheme: dark)');
  const pintarBoton = () => {
    const oscuro = esOscuro();
    boton.innerHTML = icono(oscuro ? 'sol' : 'luna');
    boton.setAttribute('aria-label', oscuro ? t('Modo oscuro. Cambiar a modo claro') : t('Modo claro. Cambiar a modo oscuro'));
    boton.title = oscuro ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro');
    estado.mapa?.cambiarTema(oscuro);
  };
  boton.addEventListener('click', () => {
    const nuevo = esOscuro() ? 'light' : 'dark';
    document.documentElement.dataset.theme = nuevo;
    guardar('tema', nuevo);
    pintarBoton();
  });
  sistema.addEventListener('change', pintarBoton);
  pintarBoton();
}
