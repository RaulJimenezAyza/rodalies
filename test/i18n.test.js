import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// i18n.js lee document.documentElement.lang: en Node no hay documento, así que se simula.
globalThis.document = { documentElement: { lang: 'ca' } };
const { t, TRADUCCIONES } = await import('../web/public/i18n.js');

test('todos los textos fijos que pasan por t() tienen su traducción al catalán', () => {
  const faltan = new Set();
  for (const archivo of ['app.js', 'mapa.js', 'cafe.js']) {
    const codigo = readFileSync(new URL(`../web/public/${archivo}`, import.meta.url), 'utf8');
    for (const [, texto] of codigo.matchAll(/\b(?:t|tr)\('((?:[^'\\]|\\.)*)'/g)) {
      if (!(texto in TRADUCCIONES)) faltan.add(`${archivo}: ${texto}`);
    }
  }
  assert.deepEqual([...faltan], []);
});

test('t rellena las piezas variables', () => {
  assert.equal(t('Va {n} minutos tarde', { n: 8 }), 'Va 8 minuts tard');
  assert.equal(t('Texto sin traducir {x}', { x: 1 }), 'Texto sin traducir 1');
});
