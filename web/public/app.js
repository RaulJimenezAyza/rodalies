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
  previo: { estacion: null, filas: new Map() }, // lo que mostraba el panel, para girar solo lo que cambia
  puntualidad: new Map(), // por línea, de /api/lineas (para la ficha de cada línea)
  fichasAbiertas: new Set(), // fichas de línea con la lista de trenes completa
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  prepararTema();
  prepararReloj();
  $('buscador-icono').innerHTML = icono('buscar');
  [estado.paradas, estado.lineas, estado.trazados] = await Promise.all([
    pedir('datos/paradas.json'), pedir('datos/lineas.json'), pedir('datos/trazados.json'),
  ]);
  prepararBuscador();
  prepararFiltro();
  $('red-barras').addEventListener('click', (e) => {
    const raya = e.target.closest('[data-clave]');
    if (raya && estado.mapa?.enfocarTren(raya.dataset.clave)) $('mapa').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
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
  } catch {
    // Se queda con lo último que tenía; el reloj avisa si los datos se hacen viejos.
  }
  estado.intentado = true;
}

function pintar() {
  pintarAhora();
  pintarPeores();
  pintarFichas();
  pintarCuentasFiltro();
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
  pintarRed();
  $('ahora-texto').innerHTML = r.peor && r.peor[2] >= UMBRAL
    ? `El que más, un ${chip(r.peor[1])} con <strong>${minutos(r.peor[2])} minutos</strong> camino de ${nombre(r.peor[3])}.`
    : 'Ningún tren lleva más de 5 minutos de retraso.';
}

// ---------- Reloj de estación ----------
function prepararReloj() {
  const formato = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const tic = () => {
    $('reloj').textContent = formato.format(new Date());
    $('tablero-reloj').textContent = $('reloj').textContent;
    if (!estado.ts) return;
    const hace = Math.max(0, Math.round(Date.now() / 1000 - estado.ts));
    const viejo = hace > 180;
    $('frescura').textContent = viejo ? 'Sin datos nuevos de Renfe' : `Datos de hace ${hace < 90 ? `${hace} s` : `${minutos(hace)} min`}`;
    $('frescura').classList.toggle('viejo', viejo);
  };
  tic();
  setInterval(tic, 1000);
}

// ---------- La red ahora: una raya por tren ----------
function pintarRed() {
  const trenes = [...estado.vivo.values()].filter((t) => t[4] || t[2] !== null);
  const tipo = (t) => (t[4] ? 'tc' : t[2] >= 600 ? 't2' : t[2] >= 180 ? 't1' : 't0');
  const orden = { t0: 0, t1: 1, t2: 2, tc: 3 };
  trenes.sort((a, b) => orden[tipo(a)] - orden[tipo(b)] || (a[2] ?? 0) - (b[2] ?? 0));
  const cuenta = { t0: 0, t1: 0, t2: 0, tc: 0 };
  for (const t of trenes) cuenta[tipo(t)]++;
  $('red-total').textContent = `${trenes.length} trenes`;
  $('red-barras').setAttribute('aria-label', `${cuenta.t0} a su hora, ${cuenta.t1} con 3 a 9 minutos, ${cuenta.t2} con 10 o más, ${cuenta.tc} cancelados`);
  $('red-barras').innerHTML = trenes.map((t) => {
    const destino = estado.destinos.get(`${t[0]}|${t[1]}`);
    const texto = `${t[1]} ${destino ? `a ${nombre(destino)}` : t[0]}: ${t[4] ? 'cancelado' : t[2] >= 60 ? `+${minutos(t[2])} min` : 'a su hora'}`;
    return `<span class="${tipo(t)}" data-clave="${t[0]}|${t[1]}" title="${texto}"></span>`;
  }).join('');
  const clave = (c, color) => `<span><i style="background:var(${color})"></i><strong>${cuenta[c]}</strong> ${{ t0: 'a su hora', t1: 'con 3–9 min', t2: 'con 10 o más', tc: 'cancelados' }[c]}</span>`;
  $('red-leyenda').innerHTML = clave('t0', '--neutro') + clave('t1', '--tarde') + clave('t2', '--muy-tarde') + (cuenta.tc ? clave('tc', '--tinta') : '');
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
          <span class="peor-retraso${retraso >= 600 ? ' mucho' : ''}">+${minutos(retraso)}′</span>${chip(linea)}
          <span class="peor-destino">${destino ? `a ${nombre(destino)}` : `Tren ${tren}`}<small>${parada ? `cerca de ${nombre(parada)}` : ''}</small></span></button></li>`;
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
    oscuro: true, // la banda de arriba es oscura en los dos modos
    trazados: estado.trazados,
    paradas: estado.paradas,
    alElegirEstacion: (id) => elegirEstacion(id, { volar: false, irAlPanel: true }),
    alElegirLinea: (linea) => alternarLinea(linea, true),
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
    if (tren) estado.mapa?.enfocarTren(tren.dataset.clave);
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
    b.innerHTML = `${b.dataset.linea}<small>${n}</small>`;
    b.title = `${estado.lineas[b.dataset.linea]?.nombre ?? b.dataset.linea}: ${n} ${n === 1 ? 'tren' : 'trenes'} ahora`;
  });
}

function aplicarFiltro() {
  const caja = $('filtro-lineas');
  caja.querySelector('.filtro-todas').setAttribute('aria-pressed', String(!estado.filtro.size));
  caja.querySelectorAll('[data-linea]').forEach((x) => x.setAttribute('aria-pressed', String(estado.filtro.has(x.dataset.linea))));
  estado.mapa?.filtrarLineas(estado.filtro);
  pintarFichas();
}

// Ficha de cada línea elegida: recorrido, trenes de ahora y puntualidad de la semana.
function pintarFichas() {
  const conPosicion = new Set(estado.posiciones.map(([tren, linea]) => `${tren}|${linea}`));
  $('fichas-linea').innerHTML = [...estado.filtro].slice(0, 3).map((linea) => {
    const trenes = [...estado.vivo.values()].filter((t) => t[1] === linea).sort((a, b) => (b[2] ?? -1) - (a[2] ?? -1));
    const enMarcha = trenes.filter((t) => !t[4] && t[2] !== null);
    const tarde = enMarcha.filter((t) => t[2] >= UMBRAL).length;
    const p = estado.puntualidad.get(linea);
    const semana = p
      ? `<span>Esta semana: <strong>${numero((p.puntuales / p.con_dato) * 100)} %</strong> puntuales · retraso medio <strong>${numero((p.retraso_medio ?? 0) / 60, 1)} min</strong></span>`
      : '';
    const MAXIMO = 6;
    const abierta = estado.fichasAbiertas.has(linea);
    const visibles = abierta ? trenes : trenes.slice(0, MAXIMO);
    const resto = trenes.length - visibles.length;
    const lista = visibles.map((t) => {
      const clave = `${t[0]}|${t[1]}`;
      const destino = estado.destinos.get(clave);
      const retraso = t[4] ? '<span class="ficha-retraso estado-cancelado">Cancel.</span>'
        : t[2] >= 180 ? `<span class="ficha-retraso ${t[2] >= 600 ? 'estado-cancelado' : 'estado-retraso'}">+${minutos(t[2])}′</span>`
          : '<span class="ficha-retraso estado-hora">A su hora</span>';
      return `<li><button type="button" data-clave="${clave}" ${conPosicion.has(clave) ? '' : 'disabled'}>${retraso}<span class="ficha-destino">a ${destino ? nombre(destino) : `tren ${t[0]}`}</span></button></li>`;
    }).join('');
    return `<article class="ficha-linea" style="--color:#${colorDe(linea)}">
      <div class="ficha-cab">${chip(linea)}<h3>${estado.lineas[linea]?.nombre ?? `Línea ${linea}`}</h3>
        <button type="button" class="enlace ficha-cerrar" data-cerrar="${linea}">Quitar</button></div>
      <p class="ficha-datos"><span>Ahora: <strong>${enMarcha.length} ${enMarcha.length === 1 ? 'tren' : 'trenes'}</strong>${enMarcha.length ? `, ${tarde} con 5 min o más` : ''}</span>${semana}</p>
      ${lista ? `<ul class="ficha-trenes">${lista}</ul>` : '<p class="ficha-vacia">No circula ningún tren de esta línea ahora mismo.</p>'}
      ${resto > 0 ? `<button type="button" class="enlace ficha-mas" data-mas="${linea}">Ver los otros ${resto} trenes</button>` : ''}
    </article>`;
  }).join('');
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
  $('tablero-estacion').textContent = nombre(estado.estacion);
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
  // Solo giran las filas que ya estaban y han cambiado (no al cargar ni al cambiar de estación).
  const mismaEstacion = estado.previo.estacion === estado.estacion;
  const filas = new Map();
  tablero.innerHTML = '<div class="tablero-cab" aria-hidden="true"><span>Hora</span><span>Línea</span><span>Destino</span><span>Estado</span></div>' + salidas.map((s) => {
    const enMin = s.estimada - ahora;
    const cuando = enMin <= 0 ? 'saliendo' : enMin < 60 ? `en ${enMin} min` : '';
    const textoEstado = {
      cancelado: '<span class="estado-cancelado">Cancelado</span>',
      retraso: `<span class="estado-retraso${s.retraso >= 10 ? ' mucho' : ''}">+${s.retraso} min</span><small>sale ${aHora(s.estimada)}</small>`,
      hora: `<span class="estado-hora">A su hora</span><small>${[s.retraso ? `+${s.retraso} min` : '', cuando].filter(Boolean).join(' · ')}</small>`,
      'sin-salir': `<span class="estado-sin">Aún no ha salido</span>${cuando ? `<small>${cuando}</small>` : ''}`,
      'sin-datos': '<span class="estado-sin">Sin datos</span>',
    }[s.estado];
    const clave = `${s.tren}|${s.linea}`;
    const firma = `${s.estado}|${s.retraso}`;
    filas.set(clave, firma);
    const cambia = mismaEstacion && estado.previo.filas.has(clave) && estado.previo.filas.get(clave) !== firma;
    const clases = ['salida', s.estado === 'cancelado' ? 'cancelado' : '', s.estado === 'retraso' ? 'tarde' : '', cambia ? 'cambia' : ''].filter(Boolean).join(' ');
    return `<div class="${clases}" style="--color:#${colorDe(s.linea)}">
      <span class="salida-hora">${s.hora}</span>
      ${chip(s.linea)}
      <div class="salida-destino"><strong>${nombre(s.destino)}</strong><span>Tren ${s.tren}</span></div>
      <div class="salida-estado">${textoEstado}</div>
    </div>`;
  }).join('');
  estado.previo = { estacion: estado.estacion, filas };
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
  estado.puntualidad = new Map(datos.lineas.filter((l) => l.con_dato >= 3).map((l) => [l.linea, l]));
  pintarFichas();
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

// ---------- Modo claro / oscuro ----------
function prepararTema() {
  const boton = $('boton-tema');
  const sistema = matchMedia('(prefers-color-scheme: dark)');
  const pintarBoton = () => {
    const oscuro = esOscuro();
    boton.innerHTML = icono(oscuro ? 'sol' : 'luna');
    boton.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
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
