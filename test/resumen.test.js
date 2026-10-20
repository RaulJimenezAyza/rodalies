import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diaDeServicio, resumir } from '../colector/src/resumen.js';

test('el día de servicio cambia a las 3 de la madrugada de Madrid', () => {
  // 20/10/2026 00:30 en Madrid (22:30 UTC del 19) todavía es servicio del 19.
  assert.equal(diaDeServicio(Date.UTC(2026, 9, 19, 22, 30) / 1000), '2026-10-19');
  // 20/10/2026 03:30 en Madrid (01:30 UTC) ya es el 20.
  assert.equal(diaDeServicio(Date.UTC(2026, 9, 20, 1, 30) / 1000), '2026-10-20');
});

test('resume cada tren: máximo, final, medio, cancelado y retraso por parada', () => {
  const t0 = Date.UTC(2026, 9, 20, 8, 0) / 1000;
  const capturas = [
    { ts: t0 + 120, trenes: [['28289', 'R2S', 300, '71801', 0]] }, // desordenadas a propósito
    { ts: t0, trenes: [['28289', 'R2S', 60, '71802', 0], ['15001', 'R11', null, null, 1]] },
    { ts: t0 + 60, trenes: [['28289', 'R2S', 120, '71801', 0]] },
  ];
  const [tren, cancelado] = resumir(capturas);
  assert.deepEqual(tren, {
    fecha: '2026-10-20', tren: '28289', linea: 'R2S', primera: t0, ultima: t0 + 120,
    retraso_max: 300, retraso_final: 300, suma: 480, n: 3, cancelado: 0,
    paradas: { 71802: 60, 71801: 300 },
  });
  assert.equal(cancelado.cancelado, 1);
  assert.equal(cancelado.n, 0);
  assert.equal(cancelado.retraso_max, null);
});
