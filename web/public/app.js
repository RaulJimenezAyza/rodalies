import { aHora, momentoDeServicio, proximasSalidas, resumenAhora, textoSobre } from './tablero.js';
import { icono } from './iconos.js';
import { crearMapa } from './mapa.js';

const ATAJOS = ['71801', '71802', '78805', '78804', '79009', '79400']; // Sants, Pg. de Gràcia, Pl. Catalunya, Arc de Triomf, Clot, Estació de França
const UMBRAL = 300; // 5 minutos: a partir de ahí cuenta como retraso en el titular
const CADA = 30_000; // cada cuánto se pide /api/vivo (solo con la pestaña visible)
const $ = (id) => document.getElementById(id);
const estado = {
  paradas: {}, lineas: {}, trazados: null, horario: null, dia: null, destinos: new Map(),
  vivo: new Map(), posiciones: [], ts: 0, estacion: leerEstacion(), filtro: new Set(), mapa: null,
};
globalThis.__rodalies = estado; // para depurar desde la consola (y para las pruebas con Playwright)

const minutos = (s) => Math.round(s / 60);
const numero = (n, dec = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const nombre = (id) => estado.paradas[id]?.[0] ?? id;
const colorDe = (linea) => estado.lineas[linea]?.color ?? '777777';
const chip = (linea) => `<span class="linea-chip" style="background:#${colorDe(linea)};color:${textoSobre(colorDe(linea))}">${linea}</span>`;
const esOscuro = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';

function leerEstacion() {
  try { return localStorage.getItem('estacion') || '71801'; } catch { return '71801'; }
}

iniciar();

async function iniciar() {
  prepararTema();
  $('buscador-icono').innerHTML = icono('buscar');
  [estado.paradas, estado.lineas, estado.trazados] = await Promise.all([
    pedir('datos/paradas.json'), pedir('datos/lineas.json'), pedir('datos/trazados.json'),
  ]);
  prepararBuscador();
  prepararFiltro();
  $('peores').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-clave]');
    if (b && estado.mapa?.enfocarTren(b.dataset.clave)) {
      const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('mapa').scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'nearest' });
    }
  });
  // El mapa y el horario no esperan a los datos en directo: si Renfe tarda, se ve todo lo demás.
  prepararMapa();
  await cargarHorario();
  pintar();
  cargarLineas();
  await cargarVivo();
  pintar();

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
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function cargarHorario() {
  const { dia } = momentoDeServicio();
  if (estado.dia === dia && estado.horario) return;
  try {
    estado.horario = await pedir(`datos/horarios/${dia}.json`);
    estado.dia = dia;
    // Destino de cada tren de hoy, para el mapa.
    estado.destinos = new Map(estado.horario.map(([tren, linea, paradas]) => [`${tren}|${linea}`, paradas.at(-1)[0]]));
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
    $('en-directo').classList.remove('caido');
  } catch {
    $('en-directo').classList.add('caido');
  }
  estado.intentado = true;
}

function pintar() {
  pintarAhora();
  pintarPeores();
  pintarTrenesEnMapa();
  pintarTablero();
}

// ---------- Ahora ----------
function pintarAhora() {
  if (!estado.ts && !estado.intentado) return; // aún cargando: se queda el "Cargando los trenes…"
  if (!estado.ts) {
    $('titular').textContent = 'No hay datos de Renfe ahora mismo';
    $('ahora-texto').textContent = 'Vuelve a intentarlo en unos minutos.';
    return;
  }
  const r = resumenAhora([...estado.vivo.values()], UMBRAL);
  const parte = r.total ? r.conRetraso / r.total : 0;
  $('titular').innerHTML = r.conRetraso === 0
    ? 'Ahora mismo Rodalies va <em class="bien">a su hora</em>'
    : parte < 0.15
      ? `Ahora mismo van tarde <em>${r.conRetraso} de ${r.total}</em> trenes`
      : `Ahora mismo, <em>${numero(parte * 100)} %</em> de los trenes van tarde`;
  $('ahora-texto').innerHTML = r.peor && r.peor[2] >= UMBRAL
    ? `El que más, un ${chip(r.peor[1])} con <strong>${minutos(r.peor[2])} minutos</strong> camino de ${nombre(r.peor[3])}.`
    : 'Ningún tren lleva más de 5 minutos de retraso.';
  const hace = Math.max(0, Math.round(Date.now() / 1000 - estado.ts));
  $('cifras').innerHTML = `
    <div><dt>Circulando</dt><dd>${r.total}</dd></div>
    <div class="${r.conRetraso ? 'mal' : ''}"><dt>Con +5 min</dt><dd>${r.conRetraso}</dd></div>
    <div class="${r.cancelados ? 'mal' : ''}"><dt>Cancelados</dt><dd>${r.cancelados}</dd></div>
    <p class="cifras-nota">Datos de Renfe de hace ${hace < 90 ? `${hace} s` : `${minutos(hace)} min`}</p>`;
}

// Los cinco que más retraso llevan ahora; al tocarlos, el mapa vuela hasta ellos.
function pintarPeores() {
  const conPosicion = new Set(estado.posiciones.map(([tren, linea]) => `${tren}|${linea}`));
  const peores = [...estado.vivo.values()]
    .filter((t) => !t[4] && t[2] !== null && t[2] >= UMBRAL)
    .sort((a, b) => b[2] - a[2])
    .slice(0, 5);
  $('peores').innerHTML = peores.length
    ? peores.map(([tren, linea, retraso, parada]) => {
        const clave = `${tren}|${linea}`;
        const destino = estado.destinos.get(clave);
        return `<li><button type="button" data-clave="${clave}" ${conPosicion.has(clave) ? '' : 'disabled title="Sin posición GPS ahora mismo"'}>
          ${chip(linea)}<span class="peor-destino">${destino ? `a ${nombre(destino)}` : `Tren ${tren}`}<small>${parada ? `cerca de ${nombre(parada)}` : ''}</small></span>
          <span class="peor-retraso${retraso >= 600 ? ' mucho' : ''}">+${minutos(retraso)}′</span></button></li>`;
      }).join('')
    : '<li class="peores-vacio">Ningún tren lleva más de 5 minutos de retraso.</li>';
}

// ---------- Mapa ----------
function prepararMapa() {
  if (!window.maplibregl) {
    $('mapa').innerHTML = '<p class="mapa-error">No se ha podido cargar el mapa.</p>';
    return;
  }
  estado.mapa = crearMapa({
    contenedor: 'mapa',
    oscuro: esOscuro(),
    trazados: estado.trazados,
    paradas: estado.paradas,
    alElegirEstacion: (id) => elegirEstacion(id, { volar: false, irAlPanel: true }),
    contenidoTren,
  });
  estado.mapa.mapa.on('load', () => {
    estado.mapa.elegirEstacion(estado.estacion, false);
    pintarTrenesEnMapa();
  });
}

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
    : p.retraso >= 3
      ? `<span class="estado-retraso${p.retraso >= 10 ? ' mucho' : ''}">+${p.retraso} min de retraso</span>`
      : '<span class="estado-hora">A su hora</span>';
  return `<div class="tren-emergente">
    <div class="tren-cab">${chip(p.linea)}<strong>${p.destino ? nombre(p.destino) : `Tren ${p.tren}`}</strong></div>
    <p>${retraso}</p>
    ${p.parada ? `<p class="tren-donde">${situacion} ${nombre(p.parada)}</p>` : ''}
    <p class="tren-numero">Tren ${p.tren}</p>
  </div>`;
}

function prepararFiltro() {
  const presentes = Object.keys(estado.lineas).filter((l) => estado.trazados.features.some((f) => f.properties.linea === l));
  const clave = (l) => [l.startsWith('R') && /^R\d/.test(l) ? 0 : 1, Number(l.replace(/\D/g, '')) || 0, l];
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
    if (b.classList.contains('filtro-todas')) estado.filtro.clear();
    else if (estado.filtro.has(b.dataset.linea)) estado.filtro.delete(b.dataset.linea);
    else estado.filtro.add(b.dataset.linea);
    caja.querySelector('.filtro-todas').setAttribute('aria-pressed', String(!estado.filtro.size));
    caja.querySelectorAll('[data-linea]').forEach((x) => x.setAttribute('aria-pressed', String(estado.filtro.has(x.dataset.linea))));
    estado.mapa?.filtrarLineas(estado.filtro);
  });
}

// ---------- Tu estación ----------
function elegirEstacion(id, { volar = true, irAlPanel = false } = {}) {
  estado.estacion = id;
  try { localStorage.setItem('estacion', id); } catch {}
  $('estacion').value = nombre(id);
  pintarAtajos();
  pintarTablero();
  estado.mapa?.elegirEstacion(id, volar);
  if (irAlPanel) {
    const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('salidas').scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'start' });
  }
}

function prepararBuscador() {
  const nombres = Object.entries(estado.paradas).sort((a, b) => a[1][0].localeCompare(b[1][0], 'es'));
  $('estaciones').innerHTML = nombres.map(([, [n]]) => `<option value="${n}"></option>`).join('');
  const porNombre = new Map(nombres.map(([id, [n]]) => [n.toLowerCase(), id]));
  const entrada = $('estacion');
  entrada.value = nombre(estado.estacion);
  entrada.addEventListener('change', () => {
    const id = porNombre.get(entrada.value.trim().toLowerCase());
    if (id) elegirEstacion(id);
  });
  entrada.addEventListener('focus', () => entrada.select());
  $('atajos').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) elegirEstacion(b.dataset.id);
  });
  pintarAtajos();
}

function pintarAtajos() {
  $('atajos').innerHTML = ATAJOS.filter((id) => estado.paradas[id])
    .map((id) => `<button type="button" data-id="${id}" aria-pressed="${id === estado.estacion}">${nombre(id).replace(/^Barcelona[- ]/, '')}</button>`)
    .join('');
}

function pintarTablero() {
  const tablero = $('tablero');
  if (!estado.horario) {
    tablero.innerHTML = '<p class="tablero-vacio">No hay horarios de hoy cargados. Vuelve a intentarlo en un rato.</p>';
    return;
  }
  const ahora = momentoDeServicio().minutos;
  const salidas = proximasSalidas(estado.horario, estado.estacion, ahora, estado.vivo);
  if (!salidas.length) {
    tablero.innerHTML = '<p class="tablero-vacio">No salen trenes de esta estación en las próximas dos horas.</p>';
    return;
  }
  tablero.innerHTML = salidas.map((s) => {
    const enMin = s.estimada - ahora;
    const cuando = enMin <= 0 ? 'saliendo' : enMin < 60 ? `en ${enMin} min` : '';
    const textoEstado = {
      cancelado: '<span class="estado-cancelado">Cancelado</span>',
      retraso: `<span class="estado-retraso${s.retraso >= 10 ? ' mucho' : ''}">+${s.retraso} min</span><small>sale ${aHora(s.estimada)}</small>`,
      hora: `<span class="estado-hora">A su hora</span><small>${[s.retraso ? `+${s.retraso} min` : '', cuando].filter(Boolean).join(' · ')}</small>`,
      'sin-salir': `<span class="estado-sin">Aún no ha salido</span>${cuando ? `<small>${cuando}</small>` : ''}`,
      'sin-datos': '<span class="estado-sin">Sin datos</span>',
    }[s.estado];
    const clases = ['salida', s.estado === 'cancelado' ? 'cancelado' : '', s.estado === 'retraso' ? 'tarde' : ''].filter(Boolean).join(' ');
    return `<div class="${clases}" style="--color:#${colorDe(s.linea)}">
      <span class="salida-hora">${s.hora}</span>
      ${chip(s.linea)}
      <div class="salida-destino"><strong>${nombre(s.destino)}</strong><span>Tren ${s.tren}</span></div>
      <div class="salida-estado">${textoEstado}</div>
    </div>`;
  }).join('');
}

// ---------- Líneas ----------
async function cargarLineas() {
  let datos;
  try {
    datos = await pedir('/api/lineas?dias=7&v=2'); // v: para saltarse respuestas antiguas en caché
  } catch {
    $('lineas-sub').textContent = 'No se han podido cargar los datos de las líneas.';
    return;
  }
  const lineas = datos.lineas.filter((l) => l.con_dato >= 3);
  const desde = lineas.reduce((a, l) => (!a || l.primera_fecha < a ? l.primera_fecha : a), null);
  const fecha = (f) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${f}T12:00:00Z`));
  $('lineas-sub').textContent = desde
    ? `Trenes que llegaron con menos de 5 minutos de retraso desde el ${fecha(desde)}${desde === '2026-10-20' ? ', el día en que esta web empezó a guardar datos. Con tan pocos días, los porcentajes aún pueden cambiar mucho' : ''}. Se actualiza cada hora.`
    : 'Todavía no hay datos suficientes: el resumen se calcula cada hora.';
  if (!lineas.length) {
    $('tabla-lineas').innerHTML = '';
    return;
  }
  const filas = lineas.map((l) => ({ ...l, pct: l.puntuales / l.con_dato })).sort((a, b) => a.pct - b.pct);
  const colorPct = (p) => (p >= 0.9 ? 'var(--bien)' : p >= 0.75 ? 'var(--medio)' : 'var(--mal)');
  $('tabla-lineas').innerHTML = `
    <div class="fila-linea cabeza" aria-hidden="true"><span>Línea</span><span>Puntuales</span><span class="dato">%</span><span class="dato">Retraso medio</span><span class="dato">Cancelados</span></div>
    ${filas.map((l) => `
      <div class="fila-linea">
        ${chip(l.linea)}
        <div class="barra-puntual" role="img" aria-label="${numero(l.pct * 100)} % puntuales"><span style="width:${(l.pct * 100).toFixed(1)}%;background:${colorPct(l.pct)}"></span></div>
        <span class="dato"><strong>${numero(l.pct * 100)} %</strong><small>${l.puntuales} de ${l.con_dato}</small></span>
        <span class="dato"><strong>${numero((l.retraso_medio ?? 0) / 60, 1)} min</strong></span>
        <span class="dato"><strong>${l.cancelados}</strong></span>
      </div>`).join('')}`;
}

// ---------- Modo claro / oscuro ----------
function prepararTema() {
  const boton = $('boton-tema');
  const sistema = matchMedia('(prefers-color-scheme: dark)');
  const pintarBoton = () => {
    const oscuro = esOscuro();
    boton.innerHTML = icono(oscuro ? 'sol' : 'luna');
    boton.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    estado.mapa?.cambiarTema(oscuro);
  };
  boton.addEventListener('click', () => {
    const nuevo = esOscuro() ? 'light' : 'dark';
    document.documentElement.dataset.theme = nuevo;
    try { localStorage.setItem('tema', nuevo); } catch {}
    pintarBoton();
  });
  sistema.addEventListener('change', pintarBoton);
  pintarBoton();
}
