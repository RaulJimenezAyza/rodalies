// Cómo se reconoce Rodalies dentro del tiempo real de Renfe (funciones puras, con tests).
//
// Los feeds GTFS-RT de Renfe traen todas las redes de Cercanías juntas. El identificador de cada viaje
// lleva la red, el número de tren y la línea: "5191M28289R2S" = red 51 (Rodalies de Catalunya) con un
// prefijo de día de servicio (91M, 92X…, cambia cada día),
// tren 28289, línea R2S. En los avisos, las rutas de Rodalies empiezan por "51T" y acaban en la línea
// ("51T0244R3" → R3).

// El prefijo cambia con el día de servicio: 5191M el martes, 5192X el miércoles… (51 = Rodalies).
const VIAJE_RODALIES = /^51\d{2}[A-Z](\d+)([A-Z].*)$/;
const RUTA_RODALIES = /^51T\d+([A-Z].*)$/;

/** Renfe a veces manda retrasos imposibles (−23 h en trenes del día anterior): esos se dejan sin dato. */
const retrasoCreible = (r) => {
  const n = Number(r);
  return r !== undefined && r !== null && Number.isFinite(n) && n > -1800 && n < 6 * 3600 ? n : null;
};

/**
 * De trip_updates.json a una captura compacta.
 * @returns {{ ts: number, trenes: Array<[string, string, number|null, string|null, 0|1]> }}
 *   ts: marca de tiempo del feed (s UNIX). Cada tren: [número, línea, retraso en s, próxima parada, cancelado].
 */
export function extraerTrenes(feed) {
  const ts = Number(feed?.header?.timestamp);
  const trenes = [];
  for (const entidad of feed?.entity ?? []) {
    const viaje = entidad.tripUpdate;
    const encaje = viaje?.trip?.tripId?.match(VIAJE_RODALIES);
    if (!encaje) continue;
    const parada = viaje.stopTimeUpdate?.[0];
    const retraso = viaje.delay ?? parada?.arrival?.delay ?? parada?.departure?.delay;
    trenes.push([
      encaje[1],
      encaje[2],
      retrasoCreible(retraso),
      parada?.stopId ?? null,
      viaje.trip.scheduleRelationship === 'CANCELED' ? 1 : 0,
    ]);
  }
  trenes.sort((a, b) => a[0].localeCompare(b[0]));
  return { ts, trenes };
}

const ESTADO_GPS = { STOPPED_AT: 'P', INCOMING_AT: 'L', IN_TRANSIT_TO: 'C' };

/**
 * De vehicle_positions.json a las posiciones GPS de los trenes de Rodalies.
 * @returns {{ ts: number|null, posiciones: Array<[string, string, number, number, 'P'|'L'|'C', string|null]> }}
 *   Cada tren: [número, línea, lat, lon, estado (parado en / llegando a / circulando hacia), parada].
 */
export function extraerPosiciones(feed) {
  const posiciones = [];
  for (const { vehicle: v } of feed?.entity ?? []) {
    const encaje = v?.trip?.tripId?.match(VIAJE_RODALIES);
    const lat = v?.position?.latitude, lon = v?.position?.longitude;
    if (!encaje || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    posiciones.push([encaje[1], encaje[2], Number(lat.toFixed(5)), Number(lon.toFixed(5)), ESTADO_GPS[v.currentStatus] ?? 'C', v.stopId ?? null]);
  }
  return { ts: Number(feed?.header?.timestamp) || null, posiciones };
}

/**
 * De alerts.json a los avisos que tocan alguna línea de Rodalies.
 * @returns {{ id: string, inicio: number|null, fin: number|null, lineas: string[], texto: string }[]}
 */
export function extraerAvisos(feed) {
  const porId = new Map(); // Renfe a veces repite un aviso en dos entradas con líneas distintas: se juntan
  for (const entidad of feed?.entity ?? []) {
    const aviso = entidad.alert;
    const lineas = new Set();
    for (const afectada of aviso?.informedEntity ?? []) {
      const encaje = afectada.routeId?.match(RUTA_RODALIES);
      if (encaje) lineas.add(encaje[1]);
    }
    if (!lineas.size) continue;
    // Renfe manda dos textos y marca los dos como "es": el primero en castellano y el segundo en catalán.
    const traducciones = aviso.descriptionText?.translation ?? [];
    const texto = (traducciones[0]?.text ?? '').trim();
    const textoCa = (traducciones[1]?.text ?? '').trim() || null;
    const periodo = aviso.activePeriod?.[0] ?? {};
    const previo = porId.get(entidad.id);
    if (previo) {
      previo.lineas = [...new Set([...previo.lineas, ...lineas])].sort();
      continue;
    }
    porId.set(entidad.id, {
      id: entidad.id,
      inicio: periodo.start ? Number(periodo.start) : null,
      fin: periodo.end ? Number(periodo.end) : null,
      lineas: [...lineas].sort(),
      texto,
      textoCa,
    });
  }
  return [...porId.values()];
}
