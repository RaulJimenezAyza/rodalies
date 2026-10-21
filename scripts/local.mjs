// Web en local con datos reales: sirve web/public y pide /api/* a la web publicada.
//   npm run local   →   http://localhost:8790
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const PUERTO = 8790;
const REMOTO = 'https://rodalies.reloda.es';
const RAIZ = new URL('../web/public/', import.meta.url);
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const r = await fetch(REMOTO + url.pathname + url.search);
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    // El service worker no se sirve en local, para que nunca enseñe una versión vieja de la caché.
    if (url.pathname === '/sw.js') return res.writeHead(404).end();
    const ruta = decodeURIComponent(url.pathname.slice(1)).replace(/(^|\/)$/, '$1index.html'); // /ca/ → ca/index.html, como Pages
    if (ruta.includes('..')) return res.writeHead(400).end();
    const contenido = await readFile(new URL(ruta, RAIZ));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(contenido);
  } catch {
    res.writeHead(404).end('No existe');
  }
}).listen(PUERTO, () => console.log(`Rodalies en local: http://localhost:${PUERTO}`));
