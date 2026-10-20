import { aHora, momentoDeServicio, proximasSalidas, resumenAhora, textoSobre } from './tablero.js';
import { icono } from './iconos.js';

const ATAJOS = ['71801', '71802', '78805', '78804', '79009', '79400']; // Sants, Pg. de Gràcia, Pl. Catalunya, Arc de Triomf, Clot, Estació de França
const UMBRAL = 300; // 5 minutos: a partir de ahí cuenta como retraso
const $ = (id) => document.getElementById(id);
const estado = { paradas: {}, lineas: {}, horario: null, dia: null, vivo: new Map(), ts: 0, estacion: leerEstacion() };

const minutos = (s) => Math.round(s / 60);
const numero = (n, dec = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const nombre = (id) => estado.paradas[id]?.[0] ?? id;
const chip = (linea) => {
  const color = estado.lineas[linea]?.color ?? '777777';
  return `<span class="linea-chip" style="background:#${color};color:${textoSobre(color)}">${linea}</span>`;
};

function leerEstacion() {
  try { return localStorage.getItem('estacion') || '71801'; } catch { return '71801'; }
}

iniciar();

async function iniciar() {
  prepararTema();
  $('buscador-icono').innerHTML = icono('buscar');
  [estado.paradas, estado.lineas] = await Promise.all([pedir('datos/paradas.json'), pedir('datos/lineas.json')]);
  prepararBuscador();
  await Promise.all([cargarHorario(), cargarAhora()]);
  pintar();
  cargarLineas();
  // Cada minuto: nueva captura de Renfe y repintar (la hora avanza aunque no cambie nada).
  setInterval(async () => {
    await cargarHorario();
    await cargarAhora();
    pintar();
  }, 60_000);
}

async function pedir(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function cargarHorario() {
  const { dia } = momentoDeServicio();
  if (estado.dia === dia && estado.horario) return;
  try {
    estado.horario = await pedir(`datos/horarios/${dia}.json`);
    estado.dia = dia;
  } catch {
    estado.horario = null;
  }
}

async function cargarAhora() {
  try {
    const datos = await pedir('/api/ahora');
    estado.ts = datos.ts;
    estado.vivo = new Map(datos.trenes.map((t) => [`${t[0]}|${t[1]}`, t]));
  } catch {
    // Se queda con lo último que tenía.
  }
}

function pintar() {
  pintarAhora();
  pintarTablero();
}

// ---------- Ahora ----------
function pintarAhora() {
  if (!estado.ts) {
    $('titular').textContent = 'No hay datos de Renfe ahora mismo';
    $('ahora-texto').textContent = 'Vuelve a intentarlo en unos minutos.';
    return;
  }
  const r = resumenAhora([...estado.vivo.values()], UMBRAL);
  const parte = r.total ? r.conRetraso / r.total : 0;
  $('titular').innerHTML = r.conRetraso === 0
    ? 'Ahora mismo Rodalies va a su hora'
    : parte < 0.15
      ? `Ahora mismo van tarde <em>${r.conRetraso} de ${r.total}</em> trenes`
      : `Ahora mismo, <em>${numero(parte * 100)} %</em> de los trenes van tarde`;
  const hace = Math.max(0, Math.round(Date.now() / 1000 - estado.ts));
  const peor = r.peor && r.peor[2] >= UMBRAL
    ? ` El que más, un ${chip(r.peor[1])} con <strong>${minutos(r.peor[2])} minutos</strong>, camino de ${nombre(r.peor[3])}.`
    : '';
  $('ahora-texto').innerHTML =
    `Circulan <strong>${r.total} trenes</strong> y ${r.conRetraso === 1 ? 'uno lleva' : `${r.conRetraso} llevan`} 5 minutos o más de retraso` +
    `${r.cancelados ? `; hay ${r.cancelados} ${r.cancelados === 1 ? 'cancelado' : 'cancelados'}` : ''}.${peor}` +
    ` <span class="estado-sin">Datos de Renfe de hace ${hace < 90 ? `${hace} s` : `${minutos(hace)} min`}.</span>`;
}

// ---------- Tu estación ----------
function prepararBuscador() {
  const nombres = Object.entries(estado.paradas).sort((a, b) => a[1][0].localeCompare(b[1][0], 'es'));
  $('estaciones').innerHTML = nombres.map(([, [n]]) => `<option value="${n}"></option>`).join('');
  const porNombre = new Map(nombres.map(([id, [n]]) => [n.toLowerCase(), id]));
  const entrada = $('estacion');
  entrada.value = nombre(estado.estacion);
  const elegir = (id) => {
    estado.estacion = id;
    try { localStorage.setItem('estacion', id); } catch {}
    entrada.value = nombre(id);
    pintarAtajos();
    pintarTablero();
  };
  entrada.addEventListener('change', () => {
    const id = porNombre.get(entrada.value.trim().toLowerCase());
    if (id) elegir(id);
  });
  entrada.addEventListener('focus', () => entrada.select());
  $('atajos').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) elegir(b.dataset.id);
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
    return `<div class="${clases}">
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
    datos = await pedir('/api/lineas?dias=7');
  } catch {
    $('lineas-sub').textContent = 'No se han podido cargar los datos de las líneas.';
    return;
  }
  const lineas = datos.lineas.filter((l) => l.con_dato >= 3);
  const desde = lineas.reduce((a, l) => (!a || l.primera_fecha < a ? l.primera_fecha : a), null);
  const fecha = (f) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${f}T12:00:00Z`));
  $('lineas-sub').textContent = desde
    ? `Trenes que llegaron con menos de 5 minutos de retraso desde el ${fecha(desde)}. Esta web empezó a guardar datos el 20 de octubre de 2026: cuantos más días pasen, más fiable será.`
    : 'Todavía no hay datos suficientes: el resumen se calcula cada hora.';
  if (!lineas.length) {
    $('tabla-lineas').innerHTML = '';
    return;
  }
  const filas = lineas
    .map((l) => ({ ...l, pct: l.puntuales / l.con_dato }))
    .sort((a, b) => a.pct - b.pct);
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
  const actual = () => document.documentElement.dataset.theme || (sistema.matches ? 'dark' : 'light');
  const pintarBoton = () => {
    const oscuro = actual() === 'dark';
    boton.innerHTML = icono(oscuro ? 'sol' : 'luna');
    boton.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  };
  boton.addEventListener('click', () => {
    const nuevo = actual() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nuevo;
    try { localStorage.setItem('tema', nuevo); } catch {}
    pintarBoton();
  });
  sistema.addEventListener('change', pintarBoton);
  pintarBoton();
}
