import {
  MUY_TARDE, TARDE, aHora, buscarEstaciones, estacionMasCercana, estadoDe, momentoDeServicio, proximasSalidas, proximosViajes, recorrido,
  resumenAhora, textoSobre,
} from './tablero.js';
import { icono } from './iconos.js';
import { crearMapa } from './mapa.js';
import { prepararCafe } from './cafe.js';

const ATAJOS = ['71801', '71802', '78805', '79009', '79400']; // Sants, Pg. de Gràcia, Pl. Catalunya, Clot, Estació de França
const UMBRAL = TARDE * 60; // segundos: a partir de ahí un tren va «tarde» en toda la web
const CADA = 30_000; // cada cuánto se pide /api/vivo (solo con la pestaña visible)
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
};
globalThis.__rodalies = estado; // para depurar desde la consola (y para las pruebas con Playwright)

const minutos = (s) => Math.round(s / 60);
const numero = (n, dec = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const nombre = (id) => estado.paradas[id]?.[0] ?? id;
const corto = (id) => nombre(id).replace(/^Barcelona[- ]/, '');
const colorDe = (linea) => estado.lineas[linea]?.color ?? '777777';
const chip = (linea) => `<span class="linea-chip" style="background:#${colorDe(linea)};color:${textoSobre(colorDe(linea))}">${linea}</span>`;
const esOscuro = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fechaCorta = (f) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${f}T12:00:00Z`));
const enCuanto = (min) => (min <= 0 ? 'saliendo ya' : min < 60 ? `sale en ${min} min` : `sale en ${Math.floor(min / 60)} h ${min % 60} min`);

/** El estado de un tren dicho en palabras, para que lo entienda cualquiera. */
function frase(estadoTren, retraso) {
  return {
    retraso: `Va ${retraso} minutos tarde`,
    leve: `Va ${retraso} ${retraso === 1 ? 'minuto' : 'minutos'} tarde`,
    hora: 'Va a su hora',
    'sin-salir': 'Aún no ha salido · hora prevista',
    'sin-datos': 'Renfe no da su posición · hora prevista',
    bus: 'Autobús por obras · hora prevista',
    cancelado: 'Cancelado',
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
  $('buscador-icono').innerHTML = icono('buscar');
  $('buscador-icono-2').innerHTML = icono('buscar');
  try {
    [estado.paradas, estado.lineas, estado.trazados] = await Promise.all([
      pedir('datos/paradas.json'), pedir('datos/lineas.json'), pedir('datos/trazados.json'),
    ]);
  } catch {
    // Sin los datos básicos no hay web: se dice claramente y se ofrece reintentar.
    $('resultado').innerHTML = '<p class="vacio-grande">No hemos podido cargar la web. Puede ser la conexión. <button type="button" class="boton-reintentar" id="reintentar">Reintentar</button></p>';
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
  await cargarVivo();
  pintar();
  if (estado.filtro.size) aplicarFiltro();

  // En directo: cada 30 s mientras la pestaña está a la vista, y en cuanto se vuelve a ella.
  setInterval(() => document.visibilityState === 'visible' && refrescar(), CADA);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refrescar());
}

async function refrescar() {
  await cargarHorario();
  await cargarVivo();
  pintar();
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
    const datos = await pedir('/api/vivo');
    estado.ts = datos.ts;
    estado.vivo = new Map(datos.trenes.map((t) => [`${t[0]}|${t[1]}`, t]));
    estado.posiciones = datos.posiciones;
  } catch {
    // Se queda con lo último que tenía; el aviso de datos viejos lo dice.
  }
  estado.intentado = true;
}

function pintar() {
  pintarViaje();
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
    asegurarMapa();
    estado.mapa?.mapa.resize();
  }
  if (!inicial) {
    scrollTo({ top: 0 });
    actualizarUrl(true);
  }
}

/** El mapa se crea la primera vez que se abre su apartado (así no se carga si no se usa). */
function asegurarMapa() {
  if (estado.mapa || !estado.trazados) return;
  if (!window.maplibregl) {
    $('mapa').innerHTML = '<p class="mapa-error">No se ha podido cargar el mapa.</p>';
    return;
  }
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
}

/** Lleva al mapa y enseña un tren. */
function irAlTren(clave) {
  mostrarVista('mapa');
  estado.mapa?.enfocarTren(clave);
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
    resultado.innerHTML = '<p class="vacio-grande">No hay horarios de hoy cargados. Vuelve a intentarlo en un rato.</p>';
    return;
  }
  const ahora = momentoDeServicio().minutos;
  if (estado.destino) {
    pintarViajes(ahora);
    $('nota-viaje').innerHTML = 'La hora de llegada es la prevista más el retraso que lleva el tren <strong>ahora</strong>. Si todavía no ha llegado a tu estación, puede recuperar o perder algo de tiempo por el camino. Toca un tren para ver todas sus paradas.';
  } else {
    pintarTablero(ahora);
    $('nota-viaje').innerHTML = 'En grande, la hora a la que sale de verdad; si va con retraso, la prevista va debajo, tachada. <strong>Toca un tren</strong> para ver a qué hora pasa por cada parada. Pon una estación en «Hasta» para ver directamente a qué hora llegas.';
  }
}

function pintarViajes(ahora) {
  const viajes = proximosViajes(estado.horario, estado.origen, estado.destino, ahora, estado.vivo);
  const cab = `<div class="viajes-cab"><h2>De <strong>${corto(estado.origen)}</strong> a <strong>${corto(estado.destino)}</strong></h2></div>`;
  if (!viajes.length) {
    $('resultado').innerHTML = `${cab}<p class="vacio-grande">No hay trenes directos de ${corto(estado.origen)} a ${corto(estado.destino)} en las próximas 3 horas. Puede que haya que hacer transbordo.</p>`;
    return;
  }
  $('resultado').innerHTML = cab + `<ol class="viajes">${viajes.map((v) => {
    const tarde = v.retraso > 0 && v.estado !== 'cancelado';
    const cancelado = v.estado === 'cancelado';
    return `<li><button type="button" class="viaje${cancelado ? ' cancelado' : ''}" data-tren="${v.tren}" data-linea="${v.linea}"
        aria-label="Tren ${v.linea} ${destinoDe(v.tren, v.linea)}: sale a las ${aHora(v.saleEstimada)} y llega a las ${aHora(v.llegaEstimada)}. ${frase(v.estado, v.retraso)}">
      <span class="viaje-linea">${chip(v.linea)}<span>${destinoDe(v.tren, v.linea)}</span></span>
      <span class="viaje-horas">
        <span class="viaje-hora"><small>Sale</small><b>${aHora(v.saleEstimada)}</b>${tarde ? `<s>${aHora(v.sale)}</s>` : ''}</span>
        <span class="viaje-flecha" aria-hidden="true">→</span>
        <span class="viaje-hora llega"><small>Llegas</small><b>${aHora(v.llegaEstimada)}</b>${tarde ? `<s>${aHora(v.llega)}</s>` : ''}</span>
      </span>
      <span class="viaje-estado ${claseEstado(v.estado, v.retraso)}">${frase(v.estado, v.retraso)}</span>
      <span class="viaje-extra">${cancelado ? '' : `${enCuanto(v.saleEstimada - ahora)} · ${v.duracion} min de viaje · `}<span class="ver-paradas">Ver paradas ›</span></span>
    </button></li>`;
  }).join('')}</ol>`;
}

function pintarTablero(ahora) {
  const salidas = proximasSalidas(estado.horario, estado.origen, ahora, estado.vivo);
  const barra = `<div class="tablero-barra"><span class="tablero-salidas">Salidas</span><strong class="tablero-estacion">${nombre(estado.origen)}</strong></div>`;
  if (!salidas.length) {
    $('resultado').innerHTML = `<div class="tablero">${barra}<p class="tablero-vacio">No salen trenes de esta estación en las próximas dos horas.</p></div>`;
    return;
  }
  // Solo giran las filas que ya estaban y han cambiado (no al cargar ni al cambiar de estación).
  const misma = estado.previo.clave === estado.origen;
  const filas = new Map();
  $('resultado').innerHTML = `<div class="tablero">${barra}<div class="tablero-cab" aria-hidden="true"><span>Sale</span><span>Línea</span><span>Destino</span><span>Estado</span></div>` + salidas.map((s) => {
    const enMin = s.estimada - ahora;
    const cuando = enMin <= 0 ? 'saliendo' : enMin < 60 ? `en ${enMin} min` : `en ${Math.floor(enMin / 60)} h ${enMin % 60} min`;
    // En grande, siempre la hora a la que sale de verdad; si no es la prevista, la prevista va debajo, tachada.
    const conRetraso = s.retraso > 0 && s.estado !== 'cancelado';
    const textoEstado = {
      cancelado: '<span class="estado-cancelado">Cancelado</span>',
      bus: `<span class="estado-bus">Autobús</span><small>${cuando}</small>`,
      retraso: `<span class="estado-retraso${s.retraso >= MUY_TARDE ? ' mucho' : ''}">+${s.retraso} min</span><small>${cuando}</small>`,
      leve: `<span class="estado-leve">+${s.retraso} min</span><small>${cuando}</small>`,
      hora: `<span class="estado-hora">A su hora</span><small>${cuando}</small>`,
      'sin-salir': `<span class="estado-sin">Aún no ha salido</span><small>${cuando}</small>`,
      'sin-datos': `<span class="estado-sin">Sin seguimiento</span><small>${cuando}</small>`,
    }[s.estado];
    const clave = `${s.tren}|${s.linea}`;
    const firma = `${s.estado}|${s.retraso}`;
    filas.set(clave, firma);
    const cambia = misma && estado.previo.filas.has(clave) && estado.previo.filas.get(clave) !== firma;
    const clases = ['salida', s.estado === 'cancelado' ? 'cancelado' : '', s.estado === 'retraso' ? 'tarde' : '', cambia ? 'cambia' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${clases}" style="--color:#${colorDe(s.linea)}" data-tren="${s.tren}" data-linea="${s.linea}"
        aria-label="${s.linea} a ${corto(s.destino)}, sale a las ${aHora(s.estimada)}. ${frase(s.estado, s.retraso)}. Ver paradas">
      <span class="salida-hora">${conRetraso ? aHora(s.estimada) : s.hora}${conRetraso ? `<s>${s.hora}</s>` : ''}</span>
      ${chip(s.linea)}
      <span class="salida-destino"><strong>${corto(s.destino)}</strong><span>${s.estado === 'bus' ? 'Servicio alternativo por carretera' : `Tren ${s.tren} · ver paradas`}</span></span>
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
      <div><h2 id="hoja-titulo">Tren ${destinoDe(tren, linea)}</h2><p>Tren ${tren}${e === 'bus' ? ' · servicio por carretera' : ''}</p></div>
      <button type="button" class="hoja-cerrar" data-cerrar-hoja>Cerrar</button>
    </div>
    <p class="hoja-estado ${claseEstado(e, retraso)}">${frase(e, retraso)}${actual ? `<span>Ahora por <strong>${corto(actual.parada)}</strong></span>` : ''}</p>
    ${conGps ? `<button type="button" class="boton-secundario" data-ver-mapa="${clave}">${icono('mapa')}Ver dónde está en el mapa</button>` : ''}
    <ol class="paradas">${paradas.map((p, k) => {
      const clases = ['parada', p.pasada ? 'pasada' : '', p.actual ? 'actual' : '', k === iOrigen ? 'origen' : '', k === iDestino ? 'destino' : '',
        iDestino > -1 && k > iOrigen && k < iDestino ? 'en-tramo' : ''].filter(Boolean).join(' ');
      const tarde = retraso > 0 && !p.pasada && e !== 'cancelado';
      const marca = p.actual ? '<em class="marca-actual">Ahora por aquí</em>' : k === iOrigen ? '<em>Subes aquí</em>' : k === iDestino ? '<em>Bajas aquí</em>' : '';
      return `<li class="${clases}">
        <span class="parada-hora"><b>${aHora(tarde ? p.estimada : p.minutos)}</b>${tarde ? `<s>${p.hora}</s>` : ''}</span>
        <span class="parada-punto" aria-hidden="true"></span>
        <span class="parada-nombre">${nombre(p.parada)}${marca}</span>
      </li>`;
    }).join('')}</ol>
    <p class="hoja-nota">${retraso > 0 ? `Las horas en grande suman los ${retraso} min de retraso que lleva ahora. ` : ''}Las paradas en gris ya las ha pasado.</p>`;
}

// ---------- Reloj y aviso de datos viejos ----------
function prepararReloj() {
  const formato = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const tic = () => {
    $('reloj').textContent = formato.format(new Date());
    if (!estado.ts) return;
    const hace = Math.max(0, Math.round(Date.now() / 1000 - estado.ts));
    $('frescura').textContent = `Datos de hace ${hace < 90 ? `${hace} s` : `${minutos(hace)} min`}`;
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
      ? `Sin conexión: lo que ves es de hace ${minutos(hace)} min.`
      : `Renfe no da datos nuevos desde hace ${minutos(hace)} min: lo que ves puede haber cambiado.`;
  }
}

// ---------- Cómo va la red ----------
function pintarAhora() {
  if (!estado.ts && !estado.intentado) return; // aún cargando: se queda el "Cargando los trenes…"
  if (!estado.ts) {
    $('titular').textContent = 'No hay datos de Renfe ahora mismo';
    $('ahora-texto').innerHTML = 'Vuelve a intentarlo en unos minutos. <button type="button" class="boton-reintentar" id="reintentar">Reintentar</button>';
    $('reintentar').addEventListener('click', refrescar);
    return;
  }
  const r = resumenAhora([...estado.vivo.values()], UMBRAL);
  const parte = r.total ? r.conRetraso / r.total : 0;
  $('titular').innerHTML = r.conRetraso === 0
    ? 'Ahora mismo Rodalies va <em class="bien">a su hora</em>'
    : parte < 0.15
      ? `Ahora mismo van tarde <em>${r.conRetraso} de ${r.total}</em> trenes`
      : `Ahora mismo, <em>${numero(parte * 100)} %</em> de los trenes van tarde`;
  pintarRed();
  $('ahora-texto').innerHTML = r.peor && r.peor[2] >= UMBRAL
    ? `«Tarde» es ${TARDE} minutos o más. El que más, un ${chip(r.peor[1])} ${destinoDe(r.peor[0], r.peor[1])}, con <strong>${minutos(r.peor[2])} minutos</strong>${r.peor[3] ? ` (ahora cerca de ${corto(r.peor[3])})` : ''}.`
    : `Ningún tren lleva ${TARDE} minutos o más de retraso.`;
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
  $('red-total').textContent = `${rayas.length} trenes`;
  $('red-barras').setAttribute('aria-label', `${cuenta.t0} a su hora, ${cuenta.t1} con ${TARDE} a ${MUY_TARDE - 1} minutos de retraso, ${cuenta.t2} con ${MUY_TARDE} o más, ${cuenta.tc} cancelados. Usa las flechas para recorrerlos.`);
  $('red-barras').innerHTML = rayas.map((t, i) => `<span class="${tipoDe(t)}" data-i="${i}"></span>`).join('');
  const clave = (c, color, texto) => `<span><i style="background:var(${color})"></i><strong>${cuenta[c]}</strong> ${texto}</span>`;
  $('red-leyenda').innerHTML = clave('t0', '--neutro', 'a su hora o casi') + clave('t1', '--tarde', `${TARDE}–${MUY_TARDE - 1} min`) +
    clave('t2', '--muy-tarde', `${MUY_TARDE} o más`) + (cuenta.tc ? clave('tc', '--tinta', cuenta.tc === 1 ? 'cancelado' : 'cancelados') : '');
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
    const estadoTren = t[4] ? 'cancelado' : t[2] >= 60 ? `+${minutos(t[2])} min` : 'a su hora';
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
        const etiqueta = `${linea} ${destinoDe(tren, linea)}, ${minutos(retraso)} minutos de retraso${parada ? `, cerca de ${corto(parada)}` : ''}`;
        return `<li><button type="button" data-clave="${clave}" aria-label="${etiqueta}" ${gps.has(clave) ? '' : 'disabled title="Sin posición GPS ahora mismo"'}>
          <span class="peor-retraso${retraso >= MUY_TARDE * 60 ? ' mucho' : ''}">+${minutos(retraso)}′</span>${chip(linea)}
          <span class="peor-destino">${destinoDe(tren, linea)}<small>${parada ? `ahora cerca de ${corto(parada)}` : ''}</small></span></button></li>`;
      }).join('')
    : `<li class="peores-vacio">Ningún tren lleva ${TARDE} minutos o más de retraso.</li>`;
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
  const situacion = { P: 'Parado en', L: 'Llegando a', C: 'Hacia' }[p.situacion] ?? 'Hacia';
  const retraso = p.cancelado
    ? '<span class="estado-cancelado">Cancelado</span>'
    : p.retraso >= TARDE
      ? `<span class="estado-retraso${p.retraso >= MUY_TARDE ? ' mucho' : ''}">+${p.retraso} min de retraso</span>`
      : `<span class="estado-hora">A su hora${p.retraso ? ` (+${p.retraso} min)` : ''}</span>`;
  return `<div class="tren-emergente">
    <div class="tren-cab">${chip(p.linea)}<strong>${p.destino ? `a ${corto(p.destino)}` : `Tren ${p.tren}`}</strong></div>
    <p>${retraso}</p>
    ${p.parada ? `<p class="tren-donde">${situacion} ${corto(p.parada)}</p>` : ''}
    <p class="tren-numero">Tren ${p.tren}</p>
    ${estado.viajes.has(`${p.tren}|${p.linea}`) ? `<button type="button" class="enlace ver-paradas-mapa" data-paradas="${p.tren}|${p.linea}">Ver a qué hora pasa por cada parada</button>` : ''}
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
  caja.innerHTML = '<button type="button" class="filtro-todas" aria-pressed="true">Todas</button>' +
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
    b.setAttribute('aria-label', `${b.dataset.linea}, ${n} ${n === 1 ? 'tren' : 'trenes'} ahora`);
    b.title = `${estado.lineas[b.dataset.linea]?.nombre ?? b.dataset.linea}: ${n} ${n === 1 ? 'tren' : 'trenes'} ahora`;
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
      ? `<span>Desde el ${fechaCorta(estado.desde ?? p.primera_fecha)}: <strong>${numero((p.puntuales / p.con_dato) * 100)} %</strong> puntuales · retraso medio <strong>${numero((p.retraso_medio ?? 0) / 60, 1)} min</strong></span>`
      : '';
    const MAXIMO = 6;
    const visibles = estado.fichasAbiertas.has(linea) ? trenes : trenes.slice(0, MAXIMO);
    const resto = trenes.length - visibles.length;
    const lista = visibles.map((t) => {
      const clave = `${t[0]}|${t[1]}`;
      const [texto, clase] = t[4] ? ['Cancel.', 'estado-cancelado']
        : t[2] >= MUY_TARDE * 60 ? [`+${minutos(t[2])}′`, 'estado-cancelado']
          : t[2] >= UMBRAL ? [`+${minutos(t[2])}′`, 'estado-retraso']
            : ['A su hora', 'estado-hora'];
      return `<li><button type="button" data-clave="${clave}" aria-label="${destinoDe(t[0], t[1])}, ${texto}" ${conPosicion.has(clave) ? '' : 'disabled'}><span class="ficha-retraso ${clase}">${texto}</span><span class="ficha-destino">${destinoDe(t[0], t[1])}</span></button></li>`;
    }).join('');
    return `<article class="ficha-linea" style="--color:#${colorDe(linea)}">
      <div class="ficha-cab">${chip(linea)}<h3>${estado.lineas[linea]?.nombre ?? `Línea ${linea}`}</h3>
        <button type="button" class="boton-cerrar" data-cerrar="${linea}" aria-label="Quitar la línea ${linea}" title="Quitar">${icono('cerrar')}</button></div>
      <p class="ficha-datos"><span>Ahora: <strong>${enMarcha.length} ${enMarcha.length === 1 ? 'tren' : 'trenes'}</strong>${enMarcha.length ? `, ${tarde} con ${TARDE} min o más` : ''}</span>${historico}</p>
      ${lista ? `<ul class="ficha-trenes">${lista}</ul>` : '<p class="ficha-vacia">No circula ningún tren de esta línea ahora mismo.</p>'}
      ${resto > 0 ? `<button type="button" class="enlace ficha-mas" data-mas="${linea}">Ver los otros ${resto} trenes</button>` : ''}
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
      : texto ? `<li class="sin-resultados">No encontramos «${texto.replace(/[<>&]/g, '')}». Prueba con otra parte del nombre.</li>` : '';
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
  boton.textContent = 'Buscando…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const cerca = estacionMasCercana(estado.paradas, coords.latitude, coords.longitude);
      if (cerca) elegirOrigen(cerca.id);
      else pintarAtajos();
    },
    () => {
      boton.textContent = 'No se pudo ubicar';
      setTimeout(pintarAtajos, 2500);
    },
    { timeout: 10_000, maximumAge: 300_000 }
  );
}

function pintarAtajos() {
  const ids = [...new Set([...recientes().filter((id) => estado.paradas[id]), ...ATAJOS])].slice(0, 6);
  $('atajos').innerHTML = ('geolocation' in navigator ? '<button type="button" data-cerca class="atajo-cerca">Cerca de mí</button>' : '') +
    ids.map((id) => `<button type="button" data-id="${id}" aria-pressed="${id === estado.origen}">${corto(id)}</button>`).join('');
}

// ---------- Líneas ----------
async function cargarLineas() {
  let datos;
  try {
    datos = await pedir('/api/lineas?dias=7&v=2'); // v: para saltarse respuestas antiguas en caché
  } catch {
    $('lineas-sub').innerHTML = 'No se han podido cargar los datos de las líneas. <button type="button" class="boton-reintentar" id="reintentar-lineas">Reintentar</button>';
    $('reintentar-lineas').addEventListener('click', cargarLineas);
    return;
  }
  const lineas = datos.lineas.filter((l) => l.con_dato >= 3);
  estado.puntualidad = new Map(lineas.map((l) => [l.linea, l]));
  estado.desde = lineas.reduce((a, l) => (!a || l.primera_fecha < a ? l.primera_fecha : a), null);
  pintarFichas();
  const desde = estado.desde;
  $('lineas-sub').textContent = desde
    ? `Porcentaje de trenes que llegaron con menos de ${TARDE} minutos de retraso desde el ${fechaCorta(desde)}${desde === '2026-10-20' ? ', el día en que esta web empezó a guardar datos. Con tan pocos días, los porcentajes aún pueden cambiar mucho' : ''}. Se actualiza cada hora.`
    : 'Todavía no hay datos suficientes: el resumen se calcula cada hora.';
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
          <div class="puesto-barra" role="img" aria-label="${numero(l.pct * 100)} % de trenes puntuales">
            <span style="width:${(l.pct * 100).toFixed(1)}%"></span><i style="left:75%"></i><i style="left:90%"></i>
          </div>
        </div>
        <span class="puesto-datos"><strong>${l.puntuales} de ${l.con_dato}</strong> puntuales<br>${numero((l.retraso_medio ?? 0) / 60, 1)} min de media${l.cancelados ? ` · ${l.cancelados} cancel.` : ''}</span>
      </li>`).join('')}</ol>
    <p class="ranking-escala"><span>Las rayitas marcan el 75 % y el 90 %.</span></p>`;
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
      aviso.textContent = 'Escribe un poco más, por favor.';
      aviso.className = 'sugerencia-estado mal';
      return;
    }
    const boton = form.querySelector('.boton-enviar');
    boton.disabled = true;
    aviso.textContent = 'Enviando…';
    aviso.className = 'sugerencia-estado';
    try {
      const r = await fetch('/api/sugerencia', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...datos, origen: estado.vista }), signal: AbortSignal.timeout(12_000),
      });
      const respuesta = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(respuesta.error || 'No se ha podido enviar.');
      form.reset();
      aviso.textContent = '¡Gracias! La hemos recibido.';
      aviso.className = 'sugerencia-estado bien';
      setTimeout(() => dialogo.open && dialogo.close(), 2200);
    } catch (error) {
      aviso.textContent = `${error.message} Inténtalo de nuevo en un rato.`;
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
    boton.setAttribute('aria-label', oscuro ? 'Modo oscuro. Cambiar a modo claro' : 'Modo claro. Cambiar a modo oscuro');
    boton.title = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
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
