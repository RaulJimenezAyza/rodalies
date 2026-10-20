/* global maplibregl */
// El mapa en directo: trazado de cada línea con su color, estaciones y cada tren en su posición GPS. Cada
// tren es un punto del color de su línea con un anillo exterior según el retraso (separado por un borde, para
// que se vea también sobre las líneas naranjas), y los que van muy tarde laten. Entre una posición y la
// siguiente el tren se desliza en vez de saltar.
//
// Mapa base de OpenFreeMap (gratis, sin clave), con datos de OpenStreetMap, aligerado: carreteras atenuadas,
// sin puntos de interés, sin fronteras y solo con los nombres de ciudades y pueblos grandes.

import { MUY_TARDE, TARDE } from './tablero.js';

const ESTILOS = {
  claro: 'https://tiles.openfreemap.org/styles/positron',
  oscuro: 'https://tiles.openfreemap.org/styles/dark',
};
const FUENTE = ['Noto Sans Bold']; // tipografía de los rótulos (la sirve OpenFreeMap)
const MOVIMIENTO_MS = 2200;
const TOLERANCIA = 16; // px alrededor del toque: los puntos son pequeños para el dedo
const quieto = matchMedia('(prefers-reduced-motion: reduce)');
const tactil = matchMedia('(pointer: coarse)').matches;
const VISTA = { center: [2.12, 41.46], zoom: matchMedia('(max-width: 700px)').matches ? 8.6 : 9.4 };

export function crearMapa({ contenedor, oscuro, trazados, paradas, alElegirEstacion, alElegirLinea, contenidoTren }) {
  const mapa = new maplibregl.Map({
    container: contenedor,
    style: oscuro ? ESTILOS.oscuro : ESTILOS.claro,
    ...VISTA,
    minZoom: 6.5,
    maxBounds: [[-0.6, 39.9], [4.2, 43.2]],
    // En el móvil se mueve con un dedo; en el ordenador, la rueda solo hace zoom con Ctrl (para no atrapar el scroll).
    cooperativeGestures: !tactil,
    touchPitch: false, // sin inclinar ni girar por accidente al pellizcar
    dragRotate: false,
    attributionControl: { compact: true },
    locale: {
      'Map.Title': 'Mapa de Rodalies',
      'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl + rueda para hacer zoom en el mapa',
      'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ + rueda para hacer zoom en el mapa',
      'CooperativeGesturesHandler.MobileHelpText': 'Usa dos dedos para mover el mapa',
      'NavigationControl.ZoomIn': 'Acercar',
      'NavigationControl.ZoomOut': 'Alejar',
      'AttributionControl.ToggleAttribution': 'Créditos del mapa',
    },
  });
  mapa.touchZoomRotate.disableRotation();
  if (tactil) mapa.doubleClickZoom.disable(); // dos toques rápidos sobre trenes no deben hacer zoom
  if (!tactil) mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right'); // en el móvil bastan los dedos
  mapa.addControl(new ControlVerTodo(() => verTodo()), 'top-right');

  const estaciones = {
    type: 'FeatureCollection',
    features: Object.entries(paradas).map(([id, [nombre, lat, lon]]) => ({
      type: 'Feature', properties: { id, nombre }, geometry: { type: 'Point', coordinates: [lon, lat] },
    })),
  };
  let tema = oscuro ? 'oscuro' : 'claro';
  let elegida = null;
  let filtro = null; // null = todas las líneas
  let mostrados = new Map(); // clave → { coord, props } tal y como se ven ahora
  let animacion = null;

  const tinta = () => (tema === 'oscuro' ? '#f1f0ea' : '#0d0d0d');
  const papel = () => (tema === 'oscuro' ? '#0f1214' : '#ffffff');
  // Sin filtro: una condición que siempre se cumple (MapLibre no admite `true` suelto dentro de 'all').
  const filtroLineas = () => (filtro ? ['in', ['get', 'linea'], ['literal', [...filtro]]] : ['has', 'linea']);
  const conRetraso = (min) => ['all', filtroLineas(), ['>=', ['get', 'retraso'], min]];
  const colorEstado = ['case', ['>=', ['get', 'retraso'], MUY_TARDE], '#e5342a', '#f2a33a'];

  // Aligerar el mapa base para que manden las líneas de tren.
  function aligerarBase() {
    for (const capa of mapa.getStyle().layers) {
      const id = capa.id;
      if (/poi|housenumber|aeroway|boundary|place_(village|hamlet|suburb|neighbou?rhood|other|isolated|locality)|(road|highway|street|transportation).*(name|label|shield)|waterway.*name|water_name|park/.test(id)) {
        mapa.setLayoutProperty(id, 'visibility', 'none');
      } else if (capa.type === 'line' && /road|highway|street|tunnel|bridge|transportation|railway|path/.test(id)) {
        mapa.setPaintProperty(id, 'line-opacity', tema === 'oscuro' ? 0.3 : 0.45);
      } else if (capa.type === 'fill' && /^water/.test(id)) {
        mapa.setPaintProperty(id, 'fill-color', tema === 'oscuro' ? '#070a0c' : '#d9e3e8'); // el mar, que no pese
      } else if (capa.type === 'symbol' && /^place/.test(id)) {
        // Rótulos de pueblos y ciudades: con halo del color del fondo para que las líneas no los tachen.
        mapa.setPaintProperty(id, 'text-halo-color', papel());
        mapa.setPaintProperty(id, 'text-halo-width', 2);
      }
    }
  }

  function ponerCapas() {
    try { aligerarBase(); } catch { /* si OpenFreeMap cambia sus capas, se queda el mapa tal cual */ }
    mapa.addSource('trazados', { type: 'geojson', data: trazados });
    mapa.addSource('estaciones', { type: 'geojson', data: estaciones });
    mapa.addSource('trenes', { type: 'geojson', data: geojson() });

    const ancho = (a, b) => ['interpolate', ['linear'], ['zoom'], 7, a, 13, b];
    // Las vías van debajo de los rótulos del mapa base, para no tachar los nombres de los pueblos.
    const primerRotulo = mapa.getStyle().layers.find((c) => c.type === 'symbol')?.id;
    mapa.addLayer({ id: 'trazados-borde', type: 'line', source: 'trazados', filter: filtroLineas(),
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': papel(), 'line-width': ancho(3.5, 9) } }, primerRotulo);
    mapa.addLayer({ id: 'trazados', type: 'line', source: 'trazados', filter: filtroLineas(),
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ancho(1.8, 5) } }, primerRotulo);

    mapa.addLayer({ id: 'estaciones', type: 'circle', source: 'estaciones', minzoom: 9.5,
      paint: { 'circle-radius': ancho(1.5, 5), 'circle-color': papel(), 'circle-stroke-color': tinta(), 'circle-stroke-width': 1.2 } });
    mapa.addLayer({ id: 'estaciones-nombre', type: 'symbol', source: 'estaciones', minzoom: 11.5,
      layout: { 'text-field': ['get', 'nombre'], 'text-font': FUENTE, 'text-size': 11, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': tinta(), 'text-halo-color': papel(), 'text-halo-width': 1.5, 'text-opacity': 0.75 } });
    mapa.addLayer({ id: 'estacion-elegida', type: 'circle', source: 'estaciones', filter: ['==', ['get', 'id'], elegida ?? ''],
      paint: { 'circle-radius': 9, 'circle-color': '#ffc23d', 'circle-stroke-color': tinta(), 'circle-stroke-width': 2.5 } });
    mapa.addLayer({ id: 'estacion-elegida-nombre', type: 'symbol', source: 'estaciones', filter: ['==', ['get', 'id'], elegida ?? ''],
      layout: { 'text-field': ['get', 'nombre'], 'text-font': FUENTE, 'text-size': 14, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': tinta(), 'text-halo-color': papel(), 'text-halo-width': 2.5 } });

    // Trenes, de abajo arriba: brillo del color de la línea, halo que late (muy tarde), anillo de estado
    // (tarde / muy tarde), el punto con su borde y la etiqueta "+11′".
    const radio = ancho(4.5, 9);
    mapa.addLayer({ id: 'trenes-brillo', type: 'circle', source: 'trenes', filter: filtroLineas(),
      paint: { 'circle-radius': ancho(10, 18), 'circle-color': ['get', 'color'], 'circle-blur': 1, 'circle-opacity': tema === 'oscuro' ? 0.45 : 0.25 } });
    mapa.addLayer({ id: 'trenes-halo', type: 'circle', source: 'trenes', filter: conRetraso(MUY_TARDE),
      paint: { 'circle-radius': 14, 'circle-blur': 0.4, 'circle-opacity': 0.3, 'circle-color': '#e5342a' } });
    mapa.addLayer({ id: 'trenes-estado', type: 'circle', source: 'trenes', filter: conRetraso(TARDE),
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 8, 13, 12.5], 'circle-color': colorEstado } });
    mapa.addLayer({ id: 'trenes', type: 'circle', source: 'trenes', filter: filtroLineas(),
      paint: {
        'circle-radius': radio,
        'circle-color': ['case', ['to-boolean', ['get', 'cancelado']], papel(), ['get', 'color']],
        'circle-stroke-width': 2,
        'circle-stroke-color': ['case', ['to-boolean', ['get', 'cancelado']], tinta(), papel()],
      } });
    mapa.addLayer({ id: 'trenes-retraso', type: 'symbol', source: 'trenes', filter: conRetraso(TARDE),
      layout: {
        'text-field': ['concat', '+', ['to-string', ['get', 'retraso']], '′'], 'text-font': FUENTE, 'text-size': 12,
        'text-offset': [0, -1.6], 'text-padding': 3, 'symbol-sort-key': ['-', 0, ['get', 'retraso']], // si chocan, gana el más tarde
      },
      paint: { 'text-color': tema === 'oscuro' ? '#ffffff' : '#0d0d0d', 'text-halo-color': colorEstado, 'text-halo-width': 3 } });
  }

  mapa.on('style.load', ponerCapas);
  mapa.on('error', (e) => console.warn('Mapa:', e.error?.message ?? e)); // p. ej. una capa mal definida
  // Créditos plegados en una «i»: MapLibre los abre al cargar en pantallas pequeñas y tapan el mapa.
  // Se pliegan cada vez que MapLibre los reabre (al cargar, al cambiar de tema), salvo si los ha abierto la persona.
  // Es un <details> que MapLibre abre por su cuenta (al cargar, al llegar los créditos de cada capa).
  // Solo se deja abierto si lo acaba de pedir la persona con la «i».
  let pedidoPorPersona = false;
  {
    const c = mapa.getContainer().querySelector('.maplibregl-ctrl-attrib'); // ya existe: lo crea el constructor
    const cerrar = () => {
      if (c?.open && !pedidoPorPersona) { c.removeAttribute('open'); c.classList.remove('maplibregl-compact-show'); }
    };
    c?.querySelector('summary')?.addEventListener('click', () => {
      pedidoPorPersona = !c.open; // va a abrirse si estaba cerrado
    }, true);
    if (c) new MutationObserver(cerrar).observe(c, { attributes: true, attributeFilter: ['open'] });
    cerrar();
  }

  // ---- Interacción: un solo manejador, con margen alrededor del toque y prioridad tren > estación > línea ----
  const emergente = new maplibregl.Popup({ closeButton: false, offset: 14, maxWidth: '280px', className: 'emergente' });
  // La burbuja nunca más ancha que el mapa (menos el hueco de los botones), para que no se corte en el móvil.
  const abrir = (coord, html) => emergente.setMaxWidth(`${Math.min(280, mapa.getContainer().clientWidth - 72)}px`)
    .setLngLat(coord).setHTML(html).addTo(mapa);
  // Estación más cercana al toque, calculada sobre todas (también cuando, alejado, no se dibujan).
  const estacionCerca = (p) => {
    let mejor = null;
    for (const [id, [, lat, lon]] of Object.entries(paradas)) {
      const q = mapa.project([lon, lat]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= TOLERANCIA && (!mejor || d < mejor.d)) mejor = { id, d };
    }
    return mejor;
  };
  const caja = (p) => [[p.x - TOLERANCIA, p.y - TOLERANCIA], [p.x + TOLERANCIA, p.y + TOLERANCIA]];
  const masCercano = (lista, p) => lista
    .map((f) => ({ f, d: Math.hypot(...((q) => [q.x - p.x, q.y - p.y])(mapa.project(f.geometry.type === 'Point' ? f.geometry.coordinates : [0, 0]))) }))
    .sort((a, b) => a.d - b.d)[0]?.f;
  const capasDe = (ids) => ids.filter((c) => mapa.getLayer(c));

  mapa.on('click', (e) => {
    const zona = caja(e.point);
    const trenes = mapa.queryRenderedFeatures(zona, { layers: capasDe(['trenes']) });
    const tren = trenes.length ? masCercano(trenes, e.point) : null;
    const estacion = estacionCerca(e.point);
    // Gana el tren, salvo que el toque esté claramente más cerca de una estación.
    const dTren = tren ? Math.hypot(...((q) => [q.x - e.point.x, q.y - e.point.y])(mapa.project(tren.geometry.coordinates))) : Infinity;
    if (tren && (!estacion || dTren <= estacion.d + 6)) return abrir(tren.geometry.coordinates, contenidoTren(tren.properties));
    if (estacion) {
      emergente.remove();
      return alElegirEstacion(estacion.id);
    }
    const lineas = mapa.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: capasDe(['trazados']) });
    if (lineas.length) alElegirLinea?.(lineas[0].properties.linea);
  });
  mapa.on('mousemove', (e) => {
    const algo = mapa.queryRenderedFeatures(caja(e.point), { layers: capasDe(['trenes']) }).length || estacionCerca(e.point)
      || mapa.queryRenderedFeatures(e.point, { layers: capasDe(['trazados']) }).length;
    mapa.getCanvas().style.cursor = algo ? 'pointer' : '';
  });

  // ---- Latido de los que van muy tarde ----
  const latir = (t) => {
    if (mapa.getLayer('trenes-halo')) {
      const fase = (Math.sin(t / 380) + 1) / 2;
      mapa.setPaintProperty('trenes-halo', 'circle-radius', 13 + fase * 10);
      mapa.setPaintProperty('trenes-halo', 'circle-opacity', 0.45 - fase * 0.3);
    }
    if (!quieto.matches) requestAnimationFrame(latir);
  };
  if (!quieto.matches) requestAnimationFrame(latir);

  function geojson(progreso = 1, desde = new Map()) {
    const features = [];
    for (const [clave, { coord, props }] of mostrados) {
      const origen = desde.get(clave);
      const c = origen && progreso < 1 ? [origen[0] + (coord[0] - origen[0]) * progreso, origen[1] + (coord[1] - origen[1]) * progreso] : coord;
      features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
    }
    return { type: 'FeatureCollection', features };
  }

  function verTodo() {
    emergente.remove();
    if (filtro) return encuadrarLineas();
    mapa.flyTo({ ...VISTA, speed: 1.4, essential: false });
  }

  function encuadrarLineas() {
    const puntos = trazados.features.filter((f) => filtro.has(f.properties.linea)).flatMap((f) => f.geometry.coordinates);
    if (!puntos.length) return;
    const lons = puntos.map((p) => p[0]), lats = puntos.map((p) => p[1]);
    mapa.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 40, maxZoom: 12, duration: quieto.matches ? 0 : 900 });
  }

  return {
    mapa,

    /** trenes: [{ clave, lon, lat, props }]. Cada uno se desliza desde donde estaba. */
    actualizarTrenes(trenes) {
      const fuente = mapa.getSource('trenes');
      const desde = new Map([...mostrados].map(([k, v]) => [k, v.coord]));
      mostrados = new Map(trenes.map((t) => [t.clave, { coord: [t.lon, t.lat], props: t.props }]));
      if (!fuente) return;
      cancelAnimationFrame(animacion);
      if (quieto.matches || !desde.size) return fuente.setData(geojson());
      const inicio = performance.now();
      const paso = (ahora) => {
        const p = Math.min(1, (ahora - inicio) / MOVIMIENTO_MS);
        const suave = 1 - (1 - p) ** 3;
        mapa.getSource('trenes')?.setData(geojson(suave, desde));
        if (p < 1) animacion = requestAnimationFrame(paso);
      };
      animacion = requestAnimationFrame(paso);
    },

    /** Vuela hasta un tren y abre su ficha. */
    enfocarTren(clave) {
      const t = mostrados.get(clave);
      if (!t) return false;
      // El tren algo por debajo del centro, para que su burbuja quepa encima.
      mapa.flyTo({ center: t.coord, zoom: Math.max(mapa.getZoom(), 11), offset: [0, 60], speed: 1.4, essential: false });
      abrir(t.coord, contenidoTren(t.props));
      return true;
    },

    elegirEstacion(id, volar) {
      elegida = id;
      for (const capa of ['estacion-elegida', 'estacion-elegida-nombre']) {
        if (mapa.getLayer(capa)) mapa.setFilter(capa, ['==', ['get', 'id'], id]);
      }
      const p = paradas[id];
      if (volar && p) mapa.flyTo({ center: [p[2], p[1]], zoom: Math.max(mapa.getZoom(), 11.5), speed: 1.2, essential: false });
    },

    filtrarLineas(lineas) {
      filtro = lineas?.size ? lineas : null;
      if (filtro) emergente.remove(); // la burbuja abierta puede ser de un tren que ya no se ve
      if (filtro) encuadrarLineas();
      if (!mapa.getLayer('trenes')) return;
      for (const id of ['trazados', 'trazados-borde', 'trenes', 'trenes-brillo']) mapa.setFilter(id, filtroLineas());
      mapa.setFilter('trenes-halo', conRetraso(MUY_TARDE));
      mapa.setFilter('trenes-estado', conRetraso(TARDE));
      mapa.setFilter('trenes-retraso', conRetraso(TARDE));
    },

    cambiarTema(oscuroAhora) {
      const nuevo = oscuroAhora ? 'oscuro' : 'claro';
      if (nuevo === tema) return;
      tema = nuevo;
      mapa.setStyle(ESTILOS[tema], { diff: false }); // al cargar, 'style.load' vuelve a poner las capas
    },
  };
}

/** Botón "ver toda la red" (o las líneas elegidas) junto al zoom. */
class ControlVerTodo {
  constructor(alPulsar) { this.alPulsar = alPulsar; }
  onAdd() {
    this.caja = document.createElement('div');
    this.caja.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.caja.innerHTML = `<button type="button" class="ver-todo" aria-label="Ver toda la red" title="Ver toda la red">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>`;
    this.caja.querySelector('button').addEventListener('click', this.alPulsar);
    return this.caja;
  }
  onRemove() { this.caja.remove(); }
}
