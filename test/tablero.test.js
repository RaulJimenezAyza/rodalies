import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aHora, aMinutos, momentoDeServicio, proximasSalidas, resumenAhora, textoSobre } from '../web/public/tablero.js';

test('minutos de servicio: después de medianoche siguen contando para el día anterior', () => {
  // 20/10/2026 01:30 en Madrid (23:30 UTC del 19) → servicio del 19, minuto 25 h 30 min.
  assert.deepEqual(momentoDeServicio(new Date(Date.UTC(2026, 9, 19, 23, 30))), { dia: '2026-10-19', minutos: 25 * 60 + 30 });
  assert.deepEqual(momentoDeServicio(new Date(Date.UTC(2026, 9, 20, 10, 0))), { dia: '2026-10-20', minutos: 12 * 60 });
  assert.equal(aMinutos('24:15'), 1455);
  assert.equal(aHora(1455), '00:15');
});

test('próximas salidas con su estado en tiempo real', () => {
  const horario = [
    ['1', 'R2S', [['A', '11:58'], ['SANTS', '12:15'], ['Z', '12:40']]],
    ['2', 'R4', [['B', '12:00'], ['SANTS', '12:20'], ['Y', '12:50']]],
    ['3', 'R1', [['SANTS', '13:30'], ['X', '13:50']]],
    ['4', 'R3', [['C', '11:00'], ['SANTS', '11:20']]], // termina en Sants: no sale
    ['5', 'R7', [['SANTS', '12:05'], ['W', '12:30']]],
    ['6', 'R8', [['D', '12:00'], ['SANTS', '12:25'], ['V', '12:45']]], // 2 min: se da por bueno
  ];
  const vivo = new Map([['1|R2S', ['1', 'R2S', 660, 'A', 0]], ['2|R4', ['2', 'R4', null, null, 1]], ['6|R8', ['6', 'R8', 120, 'D', 0]]]);
  const ahora = 12 * 60 + 10;
  const s = proximasSalidas(horario, 'SANTS', ahora, vivo);
  assert.deepEqual(s.map((x) => [x.tren, x.estado, x.estimada]), [
    ['2', 'cancelado', 740], // 12:20
    ['1', 'retraso', 746], // 12:15 + 11
    ['6', 'hora', 747], // 12:25 + 2
    ['3', 'sin-salir', 810],
  ]);
  assert.equal(s[1].destino, 'Z');
});

test('resumen de ahora y color del texto sobre cada línea', () => {
  const r = resumenAhora([['1', 'R1', 60, 'a', 0], ['2', 'R2', 700, 'b', 0], ['3', 'R3', null, null, 1]]);
  assert.equal(r.total, 2);
  assert.equal(r.conRetraso, 1);
  assert.equal(r.cancelados, 1);
  assert.equal(r.peor[0], '2');
  assert.equal(textoSobre('D0DF00'), '#111111'); // R2N, verde lima
  assert.equal(textoSobre('146520'), '#ffffff'); // R2S, verde oscuro
});
