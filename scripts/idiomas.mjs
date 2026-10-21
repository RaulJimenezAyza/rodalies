// Genera web/public/ca/index.html a partir de index.html con los textos en catalán, para que Google (y quien
// no tenga JavaScript) vea la página ya traducida. Lo que pinta app.js se traduce con web/public/i18n.js.
//   npm run idiomas   (lo hacen también desplegar:web y la acción semanal)

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ORIGEN = new URL('../web/public/index.html', import.meta.url);
const DESTINO = new URL('../web/public/ca/index.html', import.meta.url);

// [castellano, catalán]: cada trozo tiene que aparecer en index.html (si no, falla y avisa).
const CAMBIOS = [
  ['<html lang="es"', '<html lang="ca"'],
  ['<p class="pie-enlaces"><a href="/estaciones/">Todas las estaciones</a></p>', '<p class="pie-enlaces"><a href="/ca/estacions/">Totes les estacions</a></p>'],
  ['<title>Rodalies al minuto · ¿Va tarde tu tren? Retrasos en directo</title>', '<title>Rodalies al minut · Va tard el teu tren? Retards en directe</title>'],
  ['content="¿Va tarde tu tren de Rodalies? Pon de dónde a dónde vas y mira a qué hora sale y llega de verdad, con el retraso en directo. Mapa de todos los trenes y puntualidad de cada línea (R1, R2, R3, R4…)."',
    'content="Va tard el teu tren de Rodalies? Posa d\'on a on vas i mira a quina hora surt i arriba de veritat, amb el retard en directe. Mapa de tots els trens i puntualitat de cada línia (R1, R2, R3, R4…)."'],
  ['"name": "Rodalies al minuto"', '"name": "Rodalies al minut"'],
  ['"url": "https://rodalies.reloda.es/"', '"url": "https://rodalies.reloda.es/ca/"'],
  ['"description": "Retrasos de Rodalies de Catalunya en directo: salidas de cada estación, hora real de llegada, mapa de los trenes y puntualidad por línea."',
    '"description": "Retards de Rodalies de Catalunya en directe: sortides de cada estació, hora real d\'arribada, mapa dels trens i puntualitat per línia."'],
  ['"inLanguage": "es"', '"inLanguage": "ca"'],
  ['<link rel="canonical" href="https://rodalies.reloda.es/" />', '<link rel="canonical" href="https://rodalies.reloda.es/ca/" />'],
  ['<meta property="og:locale" content="es_ES" />', '<meta property="og:locale" content="ca_ES" />'],
  ['<meta property="og:url" content="https://rodalies.reloda.es/" />', '<meta property="og:url" content="https://rodalies.reloda.es/ca/" />'],
  ['<meta property="og:site_name" content="Rodalies al minuto" />', '<meta property="og:site_name" content="Rodalies al minut" />'],
  ['<meta property="og:title" content="¿Tu tren va tarde? · Rodalies al minuto" />', '<meta property="og:title" content="El teu tren va tard? · Rodalies al minut" />'],
  ['<meta property="og:description" content="Todos los trenes de Rodalies en el mapa, en directo, y las salidas de tu estación con su retraso real." />',
    '<meta property="og:description" content="Tots els trens de Rodalies al mapa, en directe, i les sortides de la teva estació amb el retard real." />'],
  ['content="Panel de salidas de Rodalies con la hora, la línea, el destino y el retraso de cada tren"', 'content="Panell de sortides de Rodalies amb l\'hora, la línia, la destinació i el retard de cada tren"'],
  ['<a class="marca" href="/">', '<a class="marca" href="/ca/">'],
  ['        Rodalies al minuto\n', '        Rodalies al minut\n'],
  ['<a href="/" hreflang="es" lang="es" data-idioma="es" aria-current="true" title="Castellano">ES</a>', '<a href="/" hreflang="es" lang="es" data-idioma="es" title="Castellano">ES</a>'],
  ['<a href="/ca/" hreflang="ca" lang="ca" data-idioma="ca" title="Català">CA</a>', '<a href="/ca/" hreflang="ca" lang="ca" data-idioma="ca" aria-current="true" title="Català">CA</a>'],
  ['<nav class="vistas" aria-label="Apartados">', '<nav class="vistas" aria-label="Apartats">'],
  ['</span>Mi viaje</button>', '</span>El meu viatge</button>'],
  ['</span>Cómo va la red</button>', '</span>Com va la xarxa</button>'],
  ['aria-label="Hora"', 'aria-label="Hora"'],
  ['<h1 class="viaje-titulo" id="titulo-viaje">¿A dónde vas?</h1>', '<h1 class="viaje-titulo" id="titulo-viaje">On vas?</h1>'],
  ['<label for="estacion">Desde</label>', '<label for="estacion">Des de</label>'],
  ['placeholder="Tu estación (p. ej. sants)"', 'placeholder="La teva estació (p. ex. sants)"'],
  ['aria-label="Estaciones" hidden></ul>\n            </div>\n          </div>\n          <button', 'aria-label="Estacions" hidden></ul>\n            </div>\n          </div>\n          <button'],
  ['aria-label="Cambiar origen y destino" title="Cambiar origen y destino"', 'aria-label="Intercanvia origen i destinació" title="Intercanvia origen i destinació"'],
  ['<label for="destino">Hasta <span class="opcional">(si quieres saber a qué hora llegas)</span></label>', '<label for="destino">Fins a <span class="opcional">(si vols saber a quina hora arribes)</span></label>'],
  ['placeholder="Cualquier destino"', 'placeholder="Qualsevol destinació"'],
  ['aria-label="Quitar el destino"', 'aria-label="Treu la destinació"'],
  ['id="destinos-lista" role="listbox" aria-label="Estaciones"', 'id="destinos-lista" role="listbox" aria-label="Estacions"'],
  ['aria-label="Estaciones frecuentes"', 'aria-label="Estacions freqüents"'],
  ['aria-label="Mapa en directo"', 'aria-label="Mapa en directe"'],
  ['aria-label="Mapa de Rodalies con los trenes en directo"', 'aria-label="Mapa de Rodalies amb els trens en directe"'],
  ['Cada punto es un tren, del color de su línea. Su borde dice el retraso:', 'Cada punt és un tren, del color de la seva línia. La vora en diu el retard:'],
  ['<i class="anillo"></i>a su hora o casi', '<i class="anillo"></i>a l\'hora o gairebé'],
  ['<i class="anillo tarde"></i>5 min o más', '<i class="anillo tarde"></i>5 min o més'],
  ['<i class="anillo muy-tarde"></i>10 min o más', '<i class="anillo muy-tarde"></i>10 min o més'],
  ['id="filtro-etiqueta">Ver una línea', 'id="filtro-etiqueta">Veure una línia'],
  ['id="titular">Cargando los trenes…', 'id="titular">Carregant els trens…'],
  ['La red ahora <span id="red-total">', 'La xarxa ara <span id="red-total">'],
  ['Cada raya es un tren circulando, de los que van a su hora (gris) a los que van muy tarde (rojo).', 'Cada ratlla és un tren circulant, dels que van a l\'hora (gris) als que van molt tard (vermell).'],
  ['Toca o pasa por encima de la raya para ver cada tren.', 'Toca o passa per sobre de la ratlla per veure cada tren.'],
  ['id="peores-titulo">Los que van más tarde', 'id="peores-titulo">Els que van més tard'],
  ['id="titulo-lineas">Puntualidad por línea', 'id="titulo-lineas">Puntualitat per línia'],
  ['<strong>¿Echas algo en falta o algo no funciona?</strong> Esta web la hace una persona en su tiempo libre: cuéntalo y lo miramos.',
    '<strong>Trobes a faltar alguna cosa o alguna cosa no funciona?</strong> Aquest web el fa una persona en el seu temps lliure: explica-ho i ho mirem.'],
  ['id="abrir-sugerencia">Enviar una sugerencia', 'id="abrir-sugerencia">Envia un suggeriment'],
  ['id="sugerencia-titulo">Tu sugerencia</h2><p>Ideas, fallos, estaciones que no salen bien…', 'id="sugerencia-titulo">El teu suggeriment</h2><p>Idees, errors, estacions que no surten bé…'],
  ['data-cerrar-sugerencia>Cerrar', 'data-cerrar-sugerencia>Tanca'],
  ['¿Qué añadirías o cambiarías?', 'Què hi afegiries o hi canviaries?'],
  ['placeholder="Por ejemplo: me gustaría que avisara cuando mi tren va tarde"', 'placeholder="Per exemple: m\'agradaria que avisés quan el meu tren va tard"'],
  ['Tu email <span class="opcional">(opcional, solo si quieres que te respondamos)</span>', 'El teu correu <span class="opcional">(opcional, només si vols que et responguem)</span>'],
  ['class="boton-enviar">Enviar', 'class="boton-enviar">Envia'],
  [`        Origen de los datos: <a href="https://data.renfe.com/" rel="noopener">Renfe Operadora</a> (tiempo real y horarios);
        web no oficial, sin relación con Renfe ni con Rodalies de Catalunya. Mapa de
        <a href="https://openfreemap.org/" rel="noopener">OpenFreeMap</a> con datos de
        <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>. Esta web guarda cada minuto
        el estado de todos los trenes de Rodalies para poder contar su puntualidad, algo que Renfe no publica. No tiene
        cuentas ni cookies (salvo las de Ko-fi si abres lo del café): solo recuerda tu estación en este navegador. Es un proyecto personal y de código abierto, en
        <a href="https://github.com/RaulJimenezAyza/rodalies" rel="noopener">GitHub</a>.`,
  `        Origen de les dades: <a href="https://data.renfe.com/" rel="noopener">Renfe Operadora</a> (temps real i horaris);
        web no oficial, sense relació amb Renfe ni amb Rodalies de Catalunya. Mapa d'
        <a href="https://openfreemap.org/" rel="noopener">OpenFreeMap</a> amb dades d'
        <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>. Aquest web desa cada minut
        l'estat de tots els trens de Rodalies per poder comptar-ne la puntualitat, una cosa que Renfe no publica. No té
        comptes ni galetes (tret de les de Ko-fi si obres el del cafè): només recorda la teva estació en aquest navegador. És un projecte personal i de codi obert, a
        <a href="https://github.com/RaulJimenezAyza/rodalies" rel="noopener">GitHub</a>.`],
];

let html = (await readFile(ORIGEN, 'utf8')).replace(/\r\n/g, '\n'); // en Windows git puede dejarlo con CRLF
for (const [es, ca] of CAMBIOS) {
  if (!html.includes(es)) throw new Error(`No encuentro en index.html: ${es.slice(0, 80)}`);
  html = html.replaceAll(es, ca);
}
await mkdir(new URL('./', DESTINO), { recursive: true });
await writeFile(DESTINO, html);
console.log(`ca/index.html: ${CAMBIOS.length} textos en catalán`);
