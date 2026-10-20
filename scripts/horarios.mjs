// Genera los horarios de Rodalies para la web a partir del GTFS de Cercanías de Renfe.
//
//   npm run horarios            (descarga el GTFS; ~16 MB)
//   npm run horarios -- archivo.zip
//
// Escribe en web/public/datos/:
//   paradas.json             { "71801": ["Barcelona-Sants", 41.37, 2.14], … }  (solo las de Rodalies)
//   lineas.json              { "R1": { "color": "7DBCEC", "texto": "FFFFFF" }, … }
//   horarios/AAAA-MM-DD.json [["28289", "R2S", [["71708", "07:42"], …]], …]   (un archivo por día)
//   horarios/indice.json     ["2026-10-20", …]
//   trazados.json            GeoJSON con el trazado de cada línea (simplificado), para el mapa
//
// Son archivos estáticos: la web los lee sin gastar peticiones de Workers ni escrituras de D1.
// El GTFS de Renfe trae unos 30 días: hay que volver a generarlos y publicar al menos cada 3 semanas.
//
// Lo que hay que saber del GTFS de Renfe:
//   - Cada día es un servicio distinto (calendar.txt con start_date = end_date) y el viaje de ese día se
//     llama como en el tiempo real: "5191M28289R2S" = servicio 5191M, tren 28289, línea R2S.
//   - Los campos vienen rellenos de espacios y routes.txt no está en UTF-8 (sí el resto).
//   - stop_times.txt pesa ~280 MB descomprimido: se lee en streaming, línea a línea.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Unzip, UnzipInflate } from 'fflate';

const URL_GTFS = 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip';
const RED = '51'; // Rodalies de Catalunya: servicios "51…", rutas "51T…"
const SALIDA = new URL('../web/public/datos/', import.meta.url);

const zip = process.argv[2]
  ? new Uint8Array(await readFile(process.argv[2]))
  : new Uint8Array(await (await fetch(URL_GTFS)).arrayBuffer());
console.log(`GTFS: ${(zip.length / 1e6).toFixed(1)} MB`);

// ---- Leer los archivos que interesan, en streaming, línea a línea ----
const lineasDe = {}; // nombre de archivo → callback(fila)
const filas = { 'calendar.txt': [], 'routes.txt': [], 'stops.txt': [], 'trips.txt': [] };
const formas = new Map(); // shape_id → [[secuencia, lon, lat]] (solo un sentido: los "_INV" son el mismo trazado al revés)
lineasDe['shapes.txt'] = (f) => {
  if (!f.shape_id.startsWith(`${RED}_`) || f.shape_id.endsWith('_INV')) return;
  if (!formas.has(f.shape_id)) formas.set(f.shape_id, []);
  formas.get(f.shape_id).push([Number(f.shape_pt_sequence), Number(f.shape_pt_lon), Number(f.shape_pt_lat)]);
};
for (const nombre of Object.keys(filas)) lineasDe[nombre] = (f) => filas[nombre].push(f);
const tiempos = new Map(); // trip_id → [[secuencia, parada, salida]]
lineasDe['stop_times.txt'] = (f) => {
  if (!f.trip_id.startsWith(RED)) return;
  if (!tiempos.has(f.trip_id)) tiempos.set(f.trip_id, []);
  tiempos.get(f.trip_id).push([Number(f.stop_sequence), f.stop_id, f.departure_time.slice(0, 5)]);
};

await new Promise((resolver, fallar) => {
  const descompresor = new Unzip((archivo) => {
    const alLeer = lineasDe[archivo.name];
    if (!alLeer) return;
    let decoder = new TextDecoder('utf-8', { fatal: true });
    let resto = '';
    let cabecera = null;
    const procesar = (texto, final) => {
      const lineas = (resto + texto).split(/\r?\n/);
      resto = final ? '' : lineas.pop();
      for (const linea of lineas) {
        if (!linea.trim()) continue;
        const campos = linea.split(',').map((c) => c.trim());
        if (!cabecera) cabecera = campos.map((c) => c.replace(/^﻿/, ''));
        else alLeer(Object.fromEntries(cabecera.map((c, i) => [c, campos[i] ?? ''])));
      }
    };
    archivo.ondata = (error, datos, final) => {
      if (error) return fallar(error);
      let texto;
      try {
        texto = decoder.decode(datos, { stream: !final });
      } catch {
        // Este archivo no es UTF-8 (routes.txt): a partir de aquí, Latin-1.
        decoder = new TextDecoder('latin1');
        texto = decoder.decode(datos, { stream: !final });
      }
      procesar(texto, final);
    };
    archivo.start();
  });
  descompresor.register(UnzipInflate);
  descompresor.push(zip, true);
  // fflate procesa en el mismo hilo; al volver de push ya ha terminado.
  resolver();
});

// ---- Días y servicios ----
const diaDe = (aaaammdd) => `${aaaammdd.slice(0, 4)}-${aaaammdd.slice(4, 6)}-${aaaammdd.slice(6, 8)}`;
const servicioDelDia = new Map();
for (const c of filas['calendar.txt']) {
  if (!c.service_id.startsWith(RED)) continue;
  for (let d = new Date(`${diaDe(c.start_date)}T12:00:00Z`); d <= new Date(`${diaDe(c.end_date)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    servicioDelDia.set(d.toISOString().slice(0, 10), c.service_id);
  }
}

// ---- Líneas, con su color y su recorrido principal ----
// Cada línea tiene muchas rutas (variantes y sentidos); su nombre es el de la ruta con más viajes.
// route_long_name viene como "Molins de Rei                    -Maçanet-Massanes": origen, espacios y "-destino".
const viajesPorRuta = new Map();
for (const v of filas['trips.txt']) if (v.route_id.startsWith(`${RED}T`)) viajesPorRuta.set(v.route_id, (viajesPorRuta.get(v.route_id) ?? 0) + 1);
const lineas = {};
const mejorRuta = {};
for (const r of filas['routes.txt']) {
  if (!r.route_id.startsWith(`${RED}T`)) continue;
  const linea = r.route_short_name;
  lineas[linea] ??= { color: r.route_color, texto: r.route_text_color };
  const viajes = viajesPorRuta.get(r.route_id) ?? 0;
  if (viajes > (mejorRuta[linea] ?? -1)) {
    mejorRuta[linea] = viajes;
    const [origen, destino] = r.route_long_name.split(/\s+-/).map((x) => x.trim());
    lineas[linea].nombre = destino ? `${origen} – ${destino}` : origen;
  }
}

// ---- Viajes por día ----
const viajesPorServicio = new Map();
const usadas = new Set();
for (const v of filas['trips.txt']) {
  if (!v.service_id.startsWith(RED)) continue;
  const encaje = v.trip_id.match(/^\d+[A-Z](\d+)([A-Z].*)$/);
  const paradas = tiempos.get(v.trip_id);
  if (!encaje || !paradas) continue;
  paradas.sort((a, b) => a[0] - b[0]);
  for (const p of paradas) usadas.add(p[1]);
  if (!viajesPorServicio.has(v.service_id)) viajesPorServicio.set(v.service_id, []);
  viajesPorServicio.get(v.service_id).push([encaje[1], encaje[2], paradas.map(([, parada, hora]) => [parada, hora])]);
}

const paradas = {};
for (const s of filas['stops.txt']) {
  if (usadas.has(s.stop_id)) paradas[s.stop_id] = [s.stop_name, Number(Number(s.stop_lat).toFixed(5)), Number(Number(s.stop_lon).toFixed(5))];
}

// ---- Escribir ----
await rm(new URL('horarios/', SALIDA), { recursive: true, force: true });
await mkdir(new URL('horarios/', SALIDA), { recursive: true });
await writeFile(new URL('paradas.json', SALIDA), JSON.stringify(paradas));
await writeFile(new URL('lineas.json', SALIDA), JSON.stringify(lineas));
const dias = [];
for (const [dia, servicio] of [...servicioDelDia].sort()) {
  const viajes = (viajesPorServicio.get(servicio) ?? []).sort((a, b) => a[2][0][1].localeCompare(b[2][0][1]));
  if (!viajes.length) continue;
  await writeFile(new URL(`horarios/${dia}.json`, SALIDA), JSON.stringify(viajes));
  dias.push(dia);
}
await writeFile(new URL('horarios/indice.json', SALIDA), JSON.stringify(dias));

// ---- Trazados para el mapa: simplificados (~20 m) y con 5 decimales (~1 m) ----
const trazados = { type: 'FeatureCollection', features: [] };
for (const [id, puntos] of formas) {
  const linea = id.slice(RED.length + 1);
  const coordenadas = simplificar(puntos.sort((a, b) => a[0] - b[0]).map(([, lon, lat]) => [lon, lat]), 0.0002)
    .map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))]);
  trazados.features.push({ type: 'Feature', properties: { linea, color: `#${lineas[linea]?.color ?? '777777'}` }, geometry: { type: 'LineString', coordinates: coordenadas } });
}
await writeFile(new URL('trazados.json', SALIDA), JSON.stringify(trazados));

/** Douglas-Peucker: quita puntos que se desvían menos de `tolerancia` (en grados) de la recta. */
function simplificar(puntos, tolerancia) {
  if (puntos.length < 3) return puntos;
  const [a, b] = [puntos[0], puntos.at(-1)];
  let maxima = 0, indice = 0;
  for (let i = 1; i < puntos.length - 1; i++) {
    const [x, y] = puntos[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const largo = Math.hypot(dx, dy) || 1e-12;
    const distancia = Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / largo;
    if (distancia > maxima) { maxima = distancia; indice = i; }
  }
  if (maxima <= tolerancia) return [a, b];
  return [...simplificar(puntos.slice(0, indice + 1), tolerancia).slice(0, -1), ...simplificar(puntos.slice(indice), tolerancia)];
}

console.log(`${trazados.features.length} trazados (${(JSON.stringify(trazados).length / 1024).toFixed(0)} KB), ${Object.keys(paradas).length} estaciones, ${Object.keys(lineas).length} líneas, ${dias.length} días (${dias[0]} → ${dias.at(-1)})`);
