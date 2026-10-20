/* global maplibregl */
// El mapa en directo: trazado de cada línea con su color, estaciones y cada tren en su posición GPS,
// con un anillo según el retraso (y latiendo si va muy tarde). Entre una posición y la siguiente el tren se
// desliza en vez de saltar.
//
// Mapa base de OpenFreeMap (gratis, sin clave), con datos de OpenStreetMap. MapLibre se carga como
// script clásico en index.html, de ahí el global.

const ESTILOS = {
  claro: 'https://tiles.openfreemap.org/styles/positron',
  oscuro: 'https://tiles.openfreemap.org/styles/dark',
};
const FUENTE = ['Noto Sans Bold']; // tipografía de los rótulos (la sirve OpenFreeMap)
const TARDE = 3; // minutos: anillo ámbar
const MUY_TARDE = 10; // minutos: anillo rojo que late
const MOVIMIENTO_MS = 2200;
const vacio = { type: 'FeatureCollection', features: [] };
const quieto = matchMedia('(prefers-reduced-motion: reduce)');

export function crearMapa({ contenedor, oscuro, trazados, paradas, alElegirEstacion, alElegirLinea, contenidoTren }) {
  const movil = matchMedia('(max-width: 700px)').matches;
  const mapa = new maplibregl.Map({
    container: contenedor,
    style: oscuro ? ESTILOS.oscuro : ESTILOS.claro,
    center: [2.1, 41.47],
    zoom: movil ? 8.4 : 9.3,
    minZoom: 6.5,
    maxBounds: [[-0.6, 39.9], [4.2, 43.2]],
    cooperativeGestures: true, // en el móvil se desplaza con dos dedos, para no atrapar el scroll de la página
    attributionControl: { compact: true },
    locale: {
      'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl + rueda para hacer zoom en el mapa',
      'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ + rueda para hacer zoom en el mapa',
      'CooperativeGesturesHandler.MobileHelpText': 'Usa dos dedos para mover el mapa',
      'NavigationControl.ZoomIn': 'Acercar',
      'NavigationControl.ZoomOut': 'Alejar',
    },
  });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

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

  const tinta = () => (tema === 'oscuro' ? '#f3f3f1' : '#0d0d0d');
  const papel = () => (tema === 'oscuro' ? '#1a1a1a' : '#ffffff');
  // Sin filtro: una condición que siempre se cumple (MapLibre no admite `true` suelto dentro de 'all').
  const filtroLineas = () => (filtro ? ['in', ['get', 'linea'], ['literal', [...filtro]]] : ['has', 'linea']);

  function ponerCapas() {
    mapa.addSource('trazados', { type: 'geojson', data: trazados });
    mapa.addSource('estaciones', { type: 'geojson', data: estaciones });
    mapa.addSource('trenes', { type: 'geojson', data: geojson() });

    const ancho = (a, b) => ['interpolate', ['linear'], ['zoom'], 7, a, 13, b];
    mapa.addLayer({ id: 'trazados-borde', type: 'line', source: 'trazados', filter: filtroLineas(),
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': papel(), 'line-width': ancho(3.5, 9) } });
    mapa.addLayer({ id: 'trazados', type: 'line', source: 'trazados', filter: filtroLineas(),
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ancho(1.8, 5) } });

    mapa.addLayer({ id: 'estaciones', type: 'circle', source: 'estaciones', minzoom: 9.5,
      paint: { 'circle-radius': ancho(1.5, 5), 'circle-color': papel(), 'circle-stroke-color': tinta(), 'circle-stroke-width': 1.2 } });
    mapa.addLayer({ id: 'estaciones-nombre', type: 'symbol', source: 'estaciones', minzoom: 11.5,
      layout: { 'text-field': ['get', 'nombre'], 'text-font': FUENTE, 'text-size': 11, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': tinta(), 'text-halo-color': papel(), 'text-halo-width': 1.5, 'text-opacity': 0.75 } });
    mapa.addLayer({ id: 'estacion-elegida', type: 'circle', source: 'estaciones', filter: ['==', ['get', 'id'], elegida ?? ''],
      paint: { 'circle-radius': 9, 'circle-color': '#f7a30d', 'circle-stroke-color': tinta(), 'circle-stroke-width': 2.5 } });
    mapa.addLayer({ id: 'estacion-elegida-nombre', type: 'symbol', source: 'estaciones', filter: ['==', ['get', 'id'], elegida ?? ''],
      layout: { 'text-field': ['get', 'nombre'], 'text-font': FUENTE, 'text-size': 14, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': tinta(), 'text-halo-color': papel(), 'text-halo-width': 2.5 } });

    // Trenes: halo (late si va muy tarde), punto del color de su línea con anillo según el retraso y "+11′".
    // Brillo suave del color de la línea debajo de cada tren (sobre el mapa oscuro parecen luces).
    mapa.addLayer({ id: 'trenes-brillo', type: 'circle', source: 'trenes', filter: filtroLineas(),
      paint: { 'circle-radius': ancho(10, 18), 'circle-color': ['get', 'color'], 'circle-blur': 1, 'circle-opacity': 0.45 } });
    mapa.addLayer({ id: 'trenes-halo', type: 'circle', source: 'trenes', filter: ['all', filtroLineas(), ['>=', ['get', 'retraso'], TARDE]],
      paint: { 'circle-radius': 14, 'circle-blur': 0.4, 'circle-opacity': 0.3,
        'circle-color': ['case', ['>=', ['get', 'retraso'], MUY_TARDE], '#e5342a', '#f2a33a'] } }); // = --muy-tarde / --tarde
    mapa.addLayer({ id: 'trenes', type: 'circle', source: 'trenes', filter: filtroLineas(),
      paint: {
        'circle-radius': ancho(4.5, 9),
        'circle-color': ['get', 'color'],
        'circle-stroke-width': ['case', ['>=', ['get', 'retraso'], TARDE], 3, 2],
        'circle-stroke-color': ['case',
          ['to-boolean', ['get', 'cancelado']], tinta(),
          ['>=', ['get', 'retraso'], MUY_TARDE], '#e5342a',
          ['>=', ['get', 'retraso'], TARDE], '#f2a33a',
          papel()],
      } });
    mapa.addLayer({ id: 'trenes-retraso', type: 'symbol', source: 'trenes', filter: ['all', filtroLineas(), ['>=', ['get', 'retraso'], 5]],
      layout: { 'text-field': ['concat', '+', ['to-string', ['get', 'retraso']], '′'], 'text-font': FUENTE, 'text-size': 12, 'text-offset': [0, -1.5] },
      paint: { 'text-color': ['case', ['>=', ['get', 'retraso'], MUY_TARDE], '#e5342a', '#c47a00'], 'text-halo-color': papel(), 'text-halo-width': 2 } });
  }

  mapa.on('style.load', ponerCapas);
  mapa.on('error', (e) => console.warn('Mapa:', e.error?.message ?? e)); // p. ej. una capa mal definida

  // ---- Interacción ----
  const emergente = new maplibregl.Popup({ closeButton: false, offset: 14, maxWidth: '280px', className: 'emergente' });
  for (const capa of ['trenes', 'estaciones', 'trazados']) {
    mapa.on('mouseenter', capa, () => (mapa.getCanvas().style.cursor = 'pointer'));
    mapa.on('mouseleave', capa, () => (mapa.getCanvas().style.cursor = ''));
  }
  mapa.on('click', 'trenes', (e) => {
    const f = e.features[0];
    emergente.setLngLat(f.geometry.coordinates).setHTML(contenidoTren(f.properties)).addTo(mapa);
  });
  // Tocar el trazado de una línea la elige (si no hay un tren o una estación justo ahí).
  mapa.on('click', 'trazados', (e) => {
    if (mapa.queryRenderedFeatures(e.point, { layers: ['trenes', 'estaciones'].filter((c) => mapa.getLayer(c)) }).length) return;
    alElegirLinea?.(e.features[0].properties.linea);
  });
  mapa.on('click', 'estaciones', (e) => {
    if (mapa.queryRenderedFeatures(e.point, { layers: ['trenes'] }).length) return; // el tren tiene prioridad
    alElegirEstacion(e.features[0].properties.id);
  });

  // ---- Latido de los que van muy tarde ----
  const latir = (t) => {
    if (mapa.getLayer('trenes-halo')) {
      const fase = (Math.sin(t / 380) + 1) / 2;
      mapa.setPaintProperty('trenes-halo', 'circle-radius', ['case', ['>=', ['get', 'retraso'], MUY_TARDE], 12 + fase * 10, 13]);
      mapa.setPaintProperty('trenes-halo', 'circle-opacity', ['case', ['>=', ['get', 'retraso'], MUY_TARDE], 0.45 - fase * 0.3, 0.3]);
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
      mapa.flyTo({ center: t.coord, zoom: Math.max(mapa.getZoom(), 11), speed: 1.4, essential: false });
      emergente.setLngLat(t.coord).setHTML(contenidoTren(t.props)).addTo(mapa);
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
      // Al elegir líneas, el mapa se ajusta para enseñarlas enteras.
      if (filtro) {
        const puntos = trazados.features.filter((f) => filtro.has(f.properties.linea)).flatMap((f) => f.geometry.coordinates);
        if (puntos.length) {
          const lons = puntos.map((p) => p[0]), lats = puntos.map((p) => p[1]);
          mapa.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
            { padding: 40, maxZoom: 12, duration: quieto.matches ? 0 : 900 });
        }
      }
      if (!mapa.getLayer('trenes')) return;
      mapa.setFilter('trazados', filtroLineas());
      mapa.setFilter('trazados-borde', filtroLineas());
      mapa.setFilter('trenes', filtroLineas());
      mapa.setFilter('trenes-brillo', filtroLineas());
      mapa.setFilter('trenes-halo', ['all', filtroLineas(), ['>=', ['get', 'retraso'], TARDE]]);
      mapa.setFilter('trenes-retraso', ['all', filtroLineas(), ['>=', ['get', 'retraso'], 5]]);
    },

    cambiarTema(oscuroAhora) {
      const nuevo = oscuroAhora ? 'oscuro' : 'claro';
      if (nuevo === tema) return;
      tema = nuevo;
      mapa.setStyle(ESTILOS[tema], { diff: false }); // al cargar, 'style.load' vuelve a poner las capas
    },
  };
}

export const SIN_TRENES = vacio;
