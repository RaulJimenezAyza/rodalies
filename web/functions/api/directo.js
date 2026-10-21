// GET /api/directo (WebSocket) → conexión con el repetidor en directo (colector/src/directo.js).
// Cada web abierta se conecta una vez y desde ahí recibe los datos nuevos sin tener que preguntar.

export async function onRequestGet({ request, env }) {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Conéctate por WebSocket', { status: 426 });
  return env.DIRECTO.get(env.DIRECTO.idFromName('rodalies')).fetch(request);
}
