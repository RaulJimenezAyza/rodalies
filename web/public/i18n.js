// Idiomas de la web: castellano (/) y catalán (/ca/). Los textos se escriben en castellano en el código y aquí
// está su traducción. Las piezas variables van entre llaves: t('Va {n} minutos tarde', { n: 8 }).
// Si falta una traducción, sale en castellano (nunca se rompe nada).

export const idioma = document.documentElement.lang === 'ca' ? 'ca' : 'es';
export const locale = idioma === 'ca' ? 'ca-ES' : 'es-ES';

const CA = {
  // Estado de un tren
  'saliendo ya': 'sortint ara',
  'sale en {n} min': "surt d'aquí a {n} min",
  'sale en {h} h {m} min': "surt d'aquí a {h} h {m} min",
  'Va {n} minutos tarde': 'Va {n} minuts tard',
  'Va 1 minuto tarde': 'Va 1 minut tard',
  'Va a su hora': "Va a l'hora",
  'Aún no ha salido · hora prevista': 'Encara no ha sortit · hora prevista',
  'Renfe no da su posición · hora prevista': 'Renfe no en dona la posició · hora prevista',
  'Autobús por obras · hora prevista': 'Autobús per obres · hora prevista',
  Cancelado: 'Cancel·lat',

  // Carga y errores
  'No hemos podido cargar la web. Puede ser la conexión.': 'No hem pogut carregar el web. Pot ser la connexió.',
  Reintentar: 'Torna-ho a provar',
  'Cargando el mapa…': 'Carregant el mapa…',
  'No se ha podido cargar el mapa.': "No s'ha pogut carregar el mapa.",
  'No hay horarios de hoy cargados. Vuelve a intentarlo en un rato.': "No hi ha horaris d'avui carregats. Torna-ho a provar d'aquí a una estona.",

  // Mi viaje
  'La hora de llegada es la prevista más el retraso que lleva el tren <strong>ahora</strong>. Si todavía no ha llegado a tu estación, puede recuperar o perder algo de tiempo por el camino. Toca un tren para ver todas sus paradas.':
    "L'hora d'arribada és la prevista més el retard que porta el tren <strong>ara</strong>. Si encara no ha arribat a la teva estació, pot recuperar o perdre una mica de temps pel camí. Toca un tren per veure totes les parades.",
  'En grande, la hora a la que sale de verdad; si va con retraso, la prevista va debajo, tachada. <strong>Toca un tren</strong> para ver a qué hora pasa por cada parada. Pon una estación en «Hasta» para ver directamente a qué hora llegas.':
    "En gran, l'hora a la qual surt de veritat; si va amb retard, la prevista va a sota, ratllada. <strong>Toca un tren</strong> per veure a quina hora passa per cada parada. Posa una estació a «Fins a» per veure directament a quina hora arribes.",
  'No hay trenes directos de {o} a {d} en las próximas 3 horas. Puede que haya que hacer transbordo.':
    'No hi ha trens directes de {o} a {d} en les properes 3 hores. Potser cal fer transbordament.',
  'Tren {linea} {destino}: sale a las {sale} y llega a las {llega}. {estado}': 'Tren {linea} {destino}: surt a les {sale} i arriba a les {llega}. {estado}',
  Sale: 'Surt',
  Llegas: 'Arribes',
  '{n} min de viaje': '{n} min de viatge',
  'Ver paradas ›': 'Veure parades ›',
  Salidas: 'Sortides',
  'No salen trenes de esta estación en las próximas dos horas.': "No surt cap tren d'aquesta estació en les properes dues hores.",
  Línea: 'Línia',
  Destino: 'Destinació',
  Estado: 'Estat',
  saliendo: 'sortint',
  Autobús: 'Autobús',
  'A su hora': "A l'hora",
  'Aún no ha salido': 'Encara no ha sortit',
  'Sin seguimiento': 'Sense seguiment',
  '{linea} a {destino}, sale a las {hora}. {estado}. Ver paradas': '{linea} a {destino}, surt a les {hora}. {estado}. Veure parades',
  'Servicio alternativo por carretera': 'Servei alternatiu per carretera',
  'Tren {n} · ver paradas': 'Tren {n} · veure parades',

  // Hoja de paradas
  ' · servicio por carretera': ' · servei per carretera',
  Cerrar: 'Tanca',
  'Ahora por <strong>{p}</strong>': 'Ara per <strong>{p}</strong>',
  'Ver dónde está en el mapa': 'Veure on és al mapa',
  'Ahora por aquí': 'Ara per aquí',
  'Subes aquí': 'Puges aquí',
  'Bajas aquí': 'Baixes aquí',
  'Las horas en grande suman los {n} min de retraso que lleva ahora. ': 'Les hores en gran sumen els {n} min de retard que porta ara. ',
  'Las paradas en gris ya las ha pasado.': 'Les parades en gris ja les ha passat.',

  // Reloj y avisos
  'Datos de hace {t}': 'Dades de fa {t}',
  'Sin conexión: lo que ves es de hace {n} min.': 'Sense connexió: el que veus és de fa {n} min.',
  'Renfe no da datos nuevos desde hace {n} min: lo que ves puede haber cambiado.': 'Renfe no dona dades noves des de fa {n} min: el que veus pot haver canviat.',

  // Cómo va la red
  'No hay datos de Renfe ahora mismo': 'Ara mateix no hi ha dades de Renfe',
  'Vuelve a intentarlo en unos minutos.': "Torna-ho a provar d'aquí a uns minuts.",
  'Ahora mismo Rodalies va <em class="bien">a su hora</em>': 'Ara mateix Rodalies va <em class="bien">a l\'hora</em>',
  'Ahora mismo van tarde <em>{a} de {b}</em> trenes': 'Ara mateix van tard <em>{a} de {b}</em> trens',
  'Ahora mismo, <em>{p} %</em> de los trenes van tarde': 'Ara mateix, el <em>{p} %</em> dels trens van tard',
  '«Tarde» es {t} minutos o más. El que más, un {chip} {destino}, con <strong>{n} minutos</strong>{donde}.':
    '«Tard» vol dir {t} minuts o més. El que més, un {chip} {destino}, amb <strong>{n} minuts</strong>{donde}.',
  ' (ahora cerca de {p})': ' (ara a prop de {p})',
  'Ningún tren lleva {t} minutos o más de retraso.': 'Cap tren no porta {t} minuts o més de retard.',
  '{a} a su hora, {b} con {t} a {m} minutos de retraso, {c} con {mt} o más, {d} cancelados. Usa las flechas para recorrerlos.':
    "{a} a l'hora, {b} amb {t} a {m} minuts de retard, {c} amb {mt} o més, {d} cancel·lats. Fes servir les fletxes per recórrer-los.",
  '{n} trenes': '{n} trens',
  'a su hora o casi': "a l'hora o gairebé",
  '{n} o más': '{n} o més',
  cancelado: 'cancel·lat',
  cancelados: 'cancel·lats',
  'a su hora': "a l'hora",
  '{linea} {destino}, {n} minutos de retraso': '{linea} {destino}, {n} minuts de retard',
  ', cerca de {p}': ', a prop de {p}',
  'Sin posición GPS ahora mismo': 'Sense posició GPS ara mateix',
  'ahora cerca de {p}': 'ara a prop de {p}',

  // Mapa
  'Parado en': 'Aturat a',
  'Llegando a': 'Arribant a',
  Hacia: 'Cap a',
  '+{n} min de retraso': '+{n} min de retard',
  'Ver a qué hora pasa por cada parada': 'Veure a quina hora passa per cada parada',
  Todas: 'Totes',
  'Desde el {f}: <strong>{p} %</strong> puntuales · retraso medio <strong>{m} min</strong>': 'Des del {f}: <strong>{p} %</strong> puntuals · retard mitjà <strong>{m} min</strong>',
  'Cancel.': 'Cancel·l.',
  'Línea {l}': 'Línia {l}',
  'Quitar la línea {l}': 'Treu la línia {l}',
  Quitar: 'Treu',
  'Ahora: <strong>{n} {trenes}</strong>': 'Ara: <strong>{n} {trenes}</strong>',
  tren: 'tren',
  trenes: 'trens',
  ', {n} con {t} min o más': ', {n} amb {t} min o més',
  'No circula ningún tren de esta línea ahora mismo.': "Ara mateix no circula cap tren d'aquesta línia.",
  'Ver los otros {n} trenes': 'Veure els altres {n} trens',
  '{l}, {n} {trenes} ahora': '{l}, {n} {trenes} ara',
  '{nombre}: {n} {trenes} ahora': '{nombre}: {n} {trenes} ara',
  'Mapa de Rodalies': 'Mapa de Rodalies',
  'Usa Ctrl + rueda para hacer zoom en el mapa': 'Fes servir Ctrl + roda per fer zoom al mapa',
  'Usa ⌘ + rueda para hacer zoom en el mapa': 'Fes servir ⌘ + roda per fer zoom al mapa',
  'Usa dos dedos para mover el mapa': 'Fes servir dos dits per moure el mapa',
  Acercar: 'Apropa',
  Alejar: 'Allunya',
  'Créditos del mapa': 'Crèdits del mapa',
  'Mapa a pantalla completa': 'Mapa a pantalla completa',
  'Salir de pantalla completa': 'Surt de la pantalla completa',
  'Ver toda la red': 'Veure tota la xarxa',

  // Buscador
  'No encontramos «{t}». Prueba con otra parte del nombre.': 'No trobem «{t}». Prova amb una altra part del nom.',
  'Buscando…': 'Buscant…',
  'No se pudo ubicar': "No s'ha pogut localitzar",
  'Cerca de mí': 'A prop meu',

  // Puntualidad
  'No se han podido cargar los datos de las líneas.': "No s'han pogut carregar les dades de les línies.",
  'Porcentaje de trenes que llegaron con menos de {t} minutos de retraso desde el {f}{extra}. Se actualiza cada hora.':
    "Percentatge de trens que van arribar amb menys de {t} minuts de retard des del {f}{extra}. S'actualitza cada hora.",
  ', el día en que esta web empezó a guardar datos. Con tan pocos días, los porcentajes aún pueden cambiar mucho':
    ', el dia que aquest web va començar a desar dades. Amb tan pocs dies, els percentatges encara poden canviar molt',
  'Todavía no hay datos suficientes: el resumen se calcula cada hora.': 'Encara no hi ha prou dades: el resum es calcula cada hora.',
  '{p} % de trenes puntuales': '{p} % de trens puntuals',
  '{p} % puntuales': '{p} % puntuals',
  '<strong>{a} de {b}</strong> puntuales<br>{m} min de media{c}': '<strong>{a} de {b}</strong> puntuals<br>{m} min de mitjana{c}',
  'Las rayitas marcan el 75 % y el 90 %.': 'Les ratlletes marquen el 75 % i el 90 %.',

  // Avisos y líneas con problemas
  'Sin datos de Renfe · puede que no circule': 'Sense dades de Renfe · potser no circula',
  'Puede que no circule': 'Potser no circula',
  'Puede que la {l} no esté circulando': 'Potser la {l} no està circulant',
  'Ahora deberían circular {b} trenes de esta línea y Renfe solo da datos de {a}.': "Ara haurien de circular {b} trens d'aquesta línia i Renfe només en dona dades de {a}.",
  'Aviso de Renfe': 'Avís de Renfe',
  'Hay un aviso en tus líneas': 'Hi ha un avís a les teves línies',
  '{n} avisos en tus líneas': '{n} avisos a les teves línies',
  'Avisos de Renfe ahora': 'Avisos de Renfe ara',
  'Renfe no tiene avisos activos en Rodalies ahora mismo.': 'Ara mateix Renfe no té avisos actius a Rodalies.',
  '+{n} líneas': '+{n} línies',
  'Desde {f}': 'Des de {f}',

  // Sugerencias
  'Escribe un poco más, por favor.': 'Escriu una mica més, si us plau.',
  'Enviando…': 'Enviant…',
  'No se ha podido enviar.': "No s'ha pogut enviar.",
  '¡Gracias! La hemos recibido.': "Gràcies! L'hem rebut.",
  '{e} Inténtalo de nuevo en un rato.': "{e} Torna-ho a provar d'aquí a una estona.",

  // Tema
  'Modo oscuro. Cambiar a modo claro': 'Mode fosc. Canvia a mode clar',
  'Modo claro. Cambiar a modo oscuro': 'Mode clar. Canvia a mode fosc',
  'Cambiar a modo claro': 'Canvia a mode clar',
  'Cambiar a modo oscuro': 'Canvia a mode fosc',

  // Café
  'Invítame a un café': "Convida'm a un cafè",
  'Invítame a un café (Ko-fi)': "Convida'm a un cafè (Ko-fi)",
  'Invítame a un café en Ko-fi': "Convida'm a un cafè a Ko-fi",
  'Quitar el botón del café': 'Treu el botó del cafè',
  'Lánzame fuera si molesto': "Llença'm fora si molesto",
  'Cargando Ko-fi…': 'Carregant Ko-fi…',
  'Pago seguro con Ko-fi (PayPal o tarjeta). ¿No carga?': 'Pagament segur amb Ko-fi (PayPal o targeta). No carrega?',
  'Ábrelo en Ko-fi': "Obre'l a Ko-fi",
};

/** Texto en el idioma de la página, con las piezas {variables} rellenas. */
export function t(texto, variables = {}) {
  const base = idioma === 'ca' ? (CA[texto] ?? texto) : texto;
  return base.replace(/\{(\w+)\}/g, (_, k) => (variables[k] ?? `{${k}}`));
}

export const TRADUCCIONES = CA; // para las pruebas (que no falte ninguna clave usada)
