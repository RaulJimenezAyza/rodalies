// POST /api/sugerencia  { texto, contacto?, origen?, web? }  → guarda una sugerencia en D1.
// Contra el spam: el campo «web» es una trampa invisible (si viene relleno, es un robot), límites de longitud
// y como mucho 5 envíos por hora desde la misma IP (se guarda una huella, nunca la IP).

import { json } from '../_lib.js';

const POR_HORA = 5;

async function huella(texto) {
  const datos = new TextEncoder().encode(`rodalies:${texto}`);
  const hash = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return json({ error: 'Formato no válido' }, 400);
  }
  const texto = String(cuerpo.texto ?? '').trim();
  const contacto = String(cuerpo.contacto ?? '').trim().slice(0, 200);
  const origen = String(cuerpo.origen ?? '').slice(0, 20);
  if (cuerpo.web) return json({ ok: true }, 200); // robot: se le dice que sí y no se guarda
  if (texto.length < 5) return json({ error: 'Escribe un poco más (mínimo 5 letras).' }, 400);
  if (texto.length > 2000) return json({ error: 'El texto es demasiado largo (máximo 2000 caracteres).' }, 400);

  const ahora = Math.floor(Date.now() / 1000);
  const ip = await huella(request.headers.get('cf-connecting-ip') ?? 'desconocida');
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM sugerencias WHERE ip_hash = ? AND ts > ?').bind(ip, ahora - 3600).first();
  if (n >= POR_HORA) return json({ error: 'Has enviado varias seguidas. Prueba otra vez dentro de un rato.' }, 429);

  await env.DB.prepare('INSERT INTO sugerencias (ts, texto, contacto, origen, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(ahora, texto, contacto || null, origen || null, ip).run();
  return json({ ok: true }, 200);
}
