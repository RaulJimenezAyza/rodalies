// "Repetidor" en directo: un único Durable Object al que se conecta (por WebSocket) cada web abierta.
// En vez de que cada móvil pregunte cada pocos segundos, el servidor manda lo nuevo a todos a la vez:
//   - el colector le pasa cada minuto los retrasos recién capturados (nuevosTrenes),
//   - y mientras haya alguien conectado, cada 20 s pide a Renfe las posiciones GPS (alarm).
// Mandar mensajes a los conectados no cuenta como petición; cada web abierta cuenta una vez, al conectarse.
//
// Usa WebSockets "hibernables": si no pasa nada, el objeto se duerme sin cortar las conexiones.

import { DurableObject } from 'cloudflare:workers';
import { extraerPosiciones } from './rodalies.js';

const POSICIONES = 'https://gtfsrt.renfe.com/vehicle_positions.json';
const CADA_GPS_MS = 20_000;

export class Directo extends DurableObject {
  /** Conexión de una web: se acepta y se le manda enseguida lo último que hay. */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Conéctate por WebSocket', { status: 426 });
    const { 0: cliente, 1: servidor } = new WebSocketPair();
    this.ctx.acceptWebSocket(servidor);
    const ultimo = (await this.ctx.storage.get('ultimo')) ?? (await this.desdeCero());
    if (ultimo) servidor.send(ultimo);
    // Si nadie estaba conectado, las posiciones estaban paradas: se piden ya (si son viejas) y luego cada 20 s.
    if (!(await this.ctx.storage.getAlarm())) {
      const tsGps = JSON.parse(ultimo ?? '{}').tsPosiciones ?? 0;
      await this.ctx.storage.setAlarm(Date.now() + (Date.now() / 1000 - tsGps > 40 ? 0 : CADA_GPS_MS));
    }
    return new Response(null, { status: 101, webSocket: cliente });
  }

  /** Lo llama el colector cada minuto con la captura nueva de retrasos. */
  // `avisos` solo viene cada 2 minutos (cuando el colector los lee); si no viene, se quedan los de antes.
  async nuevosTrenes(ts, trenes, avisos) {
    const datos = JSON.parse((await this.ctx.storage.get('ultimo')) ?? '{}');
    await this.guardarYMandar({
      ...datos, ts, trenes, posiciones: datos.posiciones ?? [], tsPosiciones: datos.tsPosiciones ?? null, avisos: avisos ?? datos.avisos ?? [],
    });
  }

  /** Cada 20 s, solo mientras haya alguien conectado: posiciones GPS nuevas para todos. */
  async alarm() {
    if (!this.ctx.getWebSockets().length) return; // nadie mirando: no se pide nada a Renfe
    try {
      const gps = await leerPosiciones();
      const datos = JSON.parse((await this.ctx.storage.get('ultimo')) ?? '{}');
      if (gps.ts !== datos.tsPosiciones) await this.guardarYMandar({ ...datos, posiciones: gps.posiciones, tsPosiciones: gps.ts });
    } catch (e) {
      console.warn('Posiciones:', e.message);
    }
    await this.ctx.storage.setAlarm(Date.now() + CADA_GPS_MS);
  }

  async guardarYMandar(datos) {
    if (!datos.ts) return;
    const mensaje = JSON.stringify(datos);
    await this.ctx.storage.put('ultimo', mensaje);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(mensaje); } catch { /* conexión que se acaba de cerrar */ }
    }
  }

  /** Primera vez (o tras borrar el objeto): se arranca con la última captura de D1 y las posiciones de ahora. */
  async desdeCero() {
    const fila = await this.env.DB.prepare('SELECT ts, trenes FROM capturas ORDER BY ts DESC LIMIT 1').first();
    if (!fila) return null;
    const avisos = await this.env.DB.prepare("SELECT valor FROM progreso WHERE clave = 'avisos_activos'").first('valor');
    const gps = await leerPosiciones().catch(() => ({ ts: null, posiciones: [] }));
    const mensaje = JSON.stringify({
      ts: fila.ts, trenes: JSON.parse(fila.trenes), posiciones: gps.posiciones, tsPosiciones: gps.ts, avisos: JSON.parse(avisos ?? '[]'),
    });
    await this.ctx.storage.put('ultimo', mensaje);
    return mensaje;
  }

  webSocketMessage() { /* la web no manda nada; si manda un ping, se ignora */ }

  webSocketClose(ws, codigo) {
    try { ws.close(codigo, 'Hasta luego'); } catch { /* ya cerrada */ }
  }
}

async function leerPosiciones() {
  const r = await fetch(POSICIONES, { cf: { cacheTtl: 0 }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Renfe respondió ${r.status}`);
  return extraerPosiciones(await r.json());
}
