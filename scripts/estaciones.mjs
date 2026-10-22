// Genera una página por estación (para que salgan en Google al buscar "trenes Mataró", "Rodalies Granollers"…),
// en castellano (/estacion/<nombre>/) y en catalán (/ca/estacio/<nombre>/), más el índice de estaciones y el
// sitemap. Cada página es la misma web con su estación ya puesta y un resumen fijo (líneas, destinos frecuentes,
// estaciones cercanas) que Google puede leer sin JavaScript.
//   npm run estaciones   (después de npm run horarios y npm run idiomas; lo hace desplegar:web y la acción semanal)

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { textoSobre } from '../web/public/tablero.js';

const WEB = new URL('../web/public/', import.meta.url);
const DOMINIO = 'https://rodalies.reloda.es';
const NUDOS = ['71801', '78805', '71802', '79400', '79009', '72400']; // Sants, Pl. Catalunya, Pg. de Gràcia, França, Clot, Aeroport

const leer = async (ruta) => JSON.parse(await readFile(new URL(ruta, WEB), 'utf8'));
const paradas = await leer('datos/paradas.json');
const lineas = await leer('datos/lineas.json');
const indice = await leer('datos/horarios/indice.json');

// El día con más trenes de la primera semana (un laborable): de ahí salen líneas y destinos de cada estación.
let horario = [];
for (const dia of indice.slice(0, 7)) {
  const h = await leer(`datos/horarios/${dia}.json`);
  if (h.length > horario.length) horario = h;
}

export const slug = (nombre) => nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/·/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const url = (id, idioma) => (idioma === 'ca' ? `/ca/estacio/${slug(paradas[id][0])}/` : `/estacion/${slug(paradas[id][0])}/`);
const corto = (id) => paradas[id][0].replace(/^Barcelona[- ]/, '');
const escapar = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ordenLinea = (l) => [/^R\d/.test(l) ? 0 : 1, Number(l.replace(/\D/g, '')) || 0, l];
const porLinea = (a, b) => {
  const [x, y] = [ordenLinea(a), ordenLinea(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
};
const chip = (l) => {
  const color = lineas[l]?.color ?? '777777';
  return `<span class="linea-chip" style="background:#${color};color:${textoSobre(color)}">${l}</span>`;
};

// ---- Qué pasa por cada estación ----
const info = new Map(Object.keys(paradas).map((id) => [id, { lineas: new Set(), destinos: new Map(), finales: new Map() }]));
for (const [, linea, recorrido] of horario) {
  recorrido.forEach(([p], i) => {
    const e = info.get(p);
    if (!e) return;
    e.lineas.add(linea);
    for (const [q] of recorrido.slice(i + 1)) e.destinos.set(q, (e.destinos.get(q) ?? 0) + 1);
    const final = recorrido.at(-1)[0];
    if (final !== p) e.finales.set(final, (e.finales.get(final) ?? 0) + 1);
  });
}
const conPagina = [...info].filter(([, e]) => e.lineas.size).map(([id]) => id);

function destinosFrecuentes(id) {
  const e = info.get(id);
  const nudos = NUDOS.filter((n) => n !== id && e.destinos.has(n)).sort((a, b) => e.destinos.get(b) - e.destinos.get(a));
  const finales = [...e.finales].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  return [...new Set([...nudos, ...finales])].filter((d) => d !== id).slice(0, 4);
}

function cercanas(id) {
  const [, lat, lon] = paradas[id];
  return conPagina.filter((o) => o !== id)
    .map((o) => [o, Math.hypot((paradas[o][1] - lat) * 111, (paradas[o][2] - lon) * 111 * Math.cos((lat * Math.PI) / 180))])
    .sort((a, b) => a[1] - b[1]).slice(0, 4).map(([o]) => o);
}

const TEXTOS = {
  es: {
    titulo: (n) => `${n}: próximos trenes y retrasos en directo · Rodalies al minuto`,
    descripcion: (n, ls) => `Salidas de ${n} en directo con el retraso real de cada tren (${ls}). Mira a qué hora sale y llega de verdad tu tren de Rodalies.`,
    og: (n) => `Trenes de ${n} en directo · Rodalies al minuto`,
    migas: 'Estaciones',
    intro: (n) => `Próximas salidas de ${escapar(n)} con el retraso real de cada tren, actualizado cada minuto.`,
    adonde: (n) => `¿A dónde vas desde ${escapar(n)}?`,
    cercanas: 'Estaciones cercanas',
    indice: '/estaciones/',
  },
  ca: {
    titulo: (n) => `${n}: propers trens i retards en directe · Rodalies al minut`,
    descripcion: (n, ls) => `Sortides de ${n} en directe amb el retard real de cada tren (${ls}). Mira a quina hora surt i arriba de veritat el teu tren de Rodalies.`,
    og: (n) => `Trens de ${n} en directe · Rodalies al minut`,
    migas: 'Estacions',
    intro: (n) => `Properes sortides de ${escapar(n)} amb el retard real de cada tren, actualitzat cada minut.`,
    adonde: (n) => `On vas des de ${escapar(n)}?`,
    cercanas: 'Estacions properes',
    indice: '/ca/estacions/',
  },
};

function cambiar(html, de, a) {
  const nuevo = html.replace(de, a);
  if (nuevo === html) throw new Error(`No encuentro en la plantilla: ${de}`);
  return nuevo;
}

function paginaEstacion(plantilla, id, idioma) {
  const T = TEXTOS[idioma];
  const nombre = paradas[id][0];
  const e = info.get(id);
  const ls = [...e.lineas].sort(porLinea);
  const [esUrl, caUrl, propia] = [url(id, 'es'), url(id, 'ca'), url(id, idioma)];
  let h = plantilla;
  h = cambiar(h, /<title>[^<]*<\/title>/, `<title>${escapar(T.titulo(nombre))}</title>`);
  h = cambiar(h, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapar(T.descripcion(nombre, ls.join(', ')))}" />`);
  h = cambiar(h, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${DOMINIO}${propia}" />`);
  h = cambiar(h, /<link rel="alternate" hreflang="es" href="[^"]*" \/>/, `<link rel="alternate" hreflang="es" href="${DOMINIO}${esUrl}" />`);
  h = cambiar(h, /<link rel="alternate" hreflang="ca" href="[^"]*" \/>/, `<link rel="alternate" hreflang="ca" href="${DOMINIO}${caUrl}" />`);
  h = cambiar(h, /<link rel="alternate" hreflang="x-default" href="[^"]*" \/>/, `<link rel="alternate" hreflang="x-default" href="${DOMINIO}${esUrl}" />`);
  h = cambiar(h, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${DOMINIO}${propia}" />`);
  h = cambiar(h, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapar(T.og(nombre))}" />`);
  h = cambiar(h, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapar(T.descripcion(nombre, ls.join(', ')))}" />`);
  h = cambiar(h, /data-alt-es="\/" data-alt-ca="\/ca\/"/, `data-alt-es="${esUrl}" data-alt-ca="${caUrl}" data-estacion="${id}"`);
  h = cambiar(h, /<a href="\/" hreflang="es"/, `<a href="${esUrl}" hreflang="es"`);
  h = cambiar(h, /<a href="\/ca\/" hreflang="ca"/, `<a href="${caUrl}" hreflang="ca"`);
  h = cambiar(h, /<h1 class="viaje-titulo" id="titulo-viaje">([^<]*)<\/h1>/, '<h2 class="viaje-titulo" id="titulo-viaje">$1</h2>');
  h = cambiar(h, '</head>', `  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'TrainStation', name: nombre, url: `${DOMINIO}${propia}`,
    geo: { '@type': 'GeoCoordinates', latitude: paradas[id][1], longitude: paradas[id][2] },
  })}</script>\n  </head>`);

  const ficha = `
        <header class="estacion-ficha">
          <p class="migas"><a href="${T.indice}">${T.migas}</a> › ${escapar(nombre)}</p>
          <h1 id="titulo-estacion">${escapar(nombre)}</h1>
          <p class="estacion-intro">${T.intro(nombre)}</p>
          <ul class="estacion-lineas">${ls.map((l) => `<li>${chip(l)}<span>${escapar(lineas[l]?.nombre ?? '')}</span><span class="estacion-puntualidad" data-linea="${l}"></span></li>`).join('')}</ul>
          <div class="destinos-rapidos"><span>${T.adonde(corto(id))}</span>
            ${destinosFrecuentes(id).map((d) => `<a href="${propia}?hasta=${d}" data-hasta="${d}">${escapar(corto(d))}</a>`).join('')}</div>
        </header>`;
  h = cambiar(h, /(<section class="vista vista-viaje" id="vista-viaje" data-vista="viaje") aria-labelledby="titulo-viaje">/, `$1 aria-labelledby="titulo-estacion">${ficha}`);
  h = cambiar(h, '<p class="tablero-nota" id="nota-viaje"></p>', `<p class="tablero-nota" id="nota-viaje"></p>
        <nav class="cercanas" aria-label="${T.cercanas}"><span>${T.cercanas}:</span> ${cercanas(id).map((o) => `<a href="${url(o, idioma)}">${escapar(paradas[o][0])}</a>`).join(' · ')}</nav>`);
  return h;
}

// Índice de todas las estaciones, por línea (enlaza todas las páginas: así Google las encuentra).
function paginaIndice(idioma) {
  const ca = idioma === 'ca';
  const lineasConEstaciones = Object.keys(lineas).sort(porLinea).map((l) => {
    let mas = [];
    for (const [, linea, recorrido] of horario) if (linea === l && recorrido.length > mas.length) mas = recorrido;
    return [l, mas.map(([p]) => p).filter((p) => info.get(p)?.lineas.size)];
  }).filter(([, ids]) => ids.length);
  const titulo = ca ? 'Estacions de Rodalies · Rodalies al minut' : 'Estaciones de Rodalies · Rodalies al minuto';
  return `<!doctype html>
<html lang="${idioma}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="/" />
    <title>${titulo}</title>
    <meta name="description" content="${ca ? 'Totes les estacions de Rodalies de Catalunya per línia, amb les sortides i els retards en directe de cadascuna.' : 'Todas las estaciones de Rodalies de Catalunya por línea, con las salidas y los retrasos en directo de cada una.'}" />
    <link rel="canonical" href="${DOMINIO}${ca ? '/ca/estacions/' : '/estaciones/'}" />
    <link rel="alternate" hreflang="es" href="${DOMINIO}/estaciones/" />
    <link rel="alternate" hreflang="ca" href="${DOMINIO}/ca/estacions/" />
    <link rel="icon" href="icono.svg" type="image/svg+xml" />
    <script>if (location.hostname === 'rodalies-reloda.pages.dev') location.replace('https://rodalies.reloda.es' + location.pathname + location.search + location.hash);
      try { const t = localStorage.getItem('tema'); if (t) document.documentElement.dataset.theme = t; } catch {}</script>
    <link rel="stylesheet" href="estilos.css" />
  </head>
  <body>
    <header class="cabecera">
      <a class="marca" href="${ca ? '/ca/' : '/'}">${ca ? 'Rodalies al minut' : 'Rodalies al minuto'}</a>
      <div class="cabecera-der"><div class="idiomas"><a href="/estaciones/" lang="es"${ca ? '' : ' aria-current="true"'}>ES</a><a href="/ca/estacions/" lang="ca"${ca ? ' aria-current="true"' : ''}>CA</a></div></div>
    </header>
    <main class="indice-estaciones">
      <h1>${ca ? 'Estacions de Rodalies' : 'Estaciones de Rodalies'}</h1>
      <p>${ca ? 'Tria la teva estació per veure les properes sortides amb el retard en directe.' : 'Elige tu estación para ver las próximas salidas con el retraso en directo.'}</p>
      ${lineasConEstaciones.map(([l, ids]) => `<section><h2>${chip(l)} ${escapar(lineas[l]?.nombre ?? '')}</h2>
        <ul>${ids.map((id) => `<li><a href="${url(id, idioma)}">${escapar(paradas[id][0])}</a></li>`).join('')}</ul></section>`).join('\n      ')}
    </main>
  </body>
</html>
`;
}

function sitemap() {
  const entrada = (es, ca, prioridad) => `  <url>
    <loc>${DOMINIO}${es}</loc><changefreq>always</changefreq><priority>${prioridad}</priority>
    <xhtml:link rel="alternate" hreflang="es" href="${DOMINIO}${es}" />
    <xhtml:link rel="alternate" hreflang="ca" href="${DOMINIO}${ca}" />
  </url>
  <url>
    <loc>${DOMINIO}${ca}</loc><changefreq>always</changefreq><priority>${prioridad}</priority>
    <xhtml:link rel="alternate" hreflang="es" href="${DOMINIO}${es}" />
    <xhtml:link rel="alternate" hreflang="ca" href="${DOMINIO}${ca}" />
  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entrada('/', '/ca/', '1.0')}
${entrada('/estaciones/', '/ca/estacions/', '0.7')}
${conPagina.map((id) => entrada(url(id, 'es'), url(id, 'ca'), '0.8')).join('\n')}
</urlset>
`;
}

// ---- Escribir ----
const plantillas = {
  es: (await readFile(new URL('index.html', WEB), 'utf8')).replace(/\r\n/g, '\n'),
  ca: (await readFile(new URL('ca/index.html', WEB), 'utf8')).replace(/\r\n/g, '\n'),
};
await rm(new URL('estacion/', WEB), { recursive: true, force: true });
await rm(new URL('ca/estacio/', WEB), { recursive: true, force: true });
for (const id of conPagina) {
  for (const idioma of ['es', 'ca']) {
    const destino = new URL(`.${url(id, idioma)}`, WEB);
    await mkdir(destino, { recursive: true });
    await writeFile(new URL('index.html', destino), paginaEstacion(plantillas[idioma], id, idioma));
  }
}
for (const [idioma, ruta] of [['es', 'estaciones/'], ['ca', 'ca/estacions/']]) {
  await mkdir(new URL(ruta, WEB), { recursive: true });
  await writeFile(new URL(`${ruta}index.html`, WEB), paginaIndice(idioma));
}
await writeFile(new URL('sitemap.xml', WEB), sitemap());
console.log(`${conPagina.length} estaciones × 2 idiomas, índice y sitemap (${(await readdir(new URL('estacion/', WEB))).length} carpetas)`);
