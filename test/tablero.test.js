import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aHora, aMinutos, buscarEstaciones, estacionMasCercana, momentoDeServicio, proximasSalidas, proximosViajes, recorrido, resumenAhora, textoSobre } from '../web/public/tablero.js';

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
    ['6', 'R8', [['D', '12:00'], ['SANTS', '12:25'], ['V', '12:45']]], // 2 min: leve
  ];
  const vivo = new Map([['1|R2S', ['1', 'R2S', 660, 'A', 0]], ['2|R4', ['2', 'R4', null, null, 1]], ['6|R8', ['6', 'R8', 120, 'D', 0]]]);
  const ahora = 12 * 60 + 10;
  const s = proximasSalidas(horario, 'SANTS', ahora, vivo);
  assert.deepEqual(s.map((x) => [x.tren, x.estado, x.estimada]), [
    ['2', 'cancelado', 740], // 12:20
    ['1', 'retraso', 746], // 12:15 + 11
    ['6', 'leve', 747], // 12:25 + 2
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

test('el texto de cada chip es el que más contraste da', () => {
  assert.equal(textoSobre('26A741'), '#111111'); // R2: con blanco no llega a 4,5:1
  assert.equal(textoSobre('88016A'), '#ffffff'); // R8, granate
});

test('buscar estación sin tildes, sin mayúsculas y por partes', () => {
  const paradas = { 1: ['Barcelona-Sants'], 2: ['Mataró'], 3: ['Granollers Centre'], 4: ['Granollers-Canovelles'], 5: ['Les Franqueses-Granollers Nord'] };
  assert.deepEqual(buscarEstaciones(paradas, 'sants').map((e) => e.id), ['1']);
  assert.deepEqual(buscarEstaciones(paradas, 'MATARO').map((e) => e.id), ['2']);
  assert.deepEqual(buscarEstaciones(paradas, 'granollers').map((e) => e.id), ['3', '4', '5']);
  assert.deepEqual(buscarEstaciones(paradas, 'xyz'), []);
});

test('estación más cercana', () => {
  const paradas = { a: ['Sants', 41.379, 2.141], b: ['Mataró', 41.538, 2.445] };
  assert.equal(estacionMasCercana(paradas, 41.54, 2.44).id, 'b');
});

test('proximasSalidas: los viajes en autobús salen como «bus», aunque haya datos en directo', () => {
  const horario = [['1', 'R3', [['A', '10:00'], ['B', '10:30']], 1]];
  const [s] = proximasSalidas(horario, 'A', 9 * 60 + 50, new Map([['1|R3', ['1', 'R3', 600, null, false]]]));
  assert.equal(s.estado, 'bus');
  assert.equal(s.retraso, 0);
});

const DIA = [
  ['1', 'R1', [['A', '10:00'], ['B', '10:10'], ['C', '10:30'], ['D', '10:40']]],
  ['2', 'R1', [['D', '10:05'], ['C', '10:15'], ['B', '10:35'], ['A', '10:45']]], // sentido contrario
  ['3', 'R1', [['A', '10:20'], ['B', '10:30']]], // no llega a C
];

test('proximosViajes: solo los que van de origen a destino en ese sentido, con salida y llegada reales', () => {
  const vivo = new Map([['1|R1', ['1', 'R1', 480, 'A', 0]]]); // 8 min tarde
  const v = proximosViajes(DIA, 'B', 'C', 9 * 60 + 55, vivo);
  assert.equal(v.length, 1);
  assert.equal(v[0].tren, '1');
  assert.equal(aHora(v[0].sale), '10:10');
  assert.equal(aHora(v[0].saleEstimada), '10:18');
  assert.equal(aHora(v[0].llegaEstimada), '10:38');
  assert.equal(v[0].duracion, 20);
  assert.equal(v[0].estado, 'retraso');
});

test('recorrido: marca las paradas pasadas y la actual, y suma el retraso a todas', () => {
  const vivo = new Map([['1|R1', ['1', 'R1', 300, 'C', 0]]]);
  const r = recorrido(DIA[0], vivo);
  assert.deepEqual(r.map((p) => [p.parada, p.pasada, p.actual]), [['A', true, false], ['B', true, false], ['C', false, true], ['D', false, false]]);
  assert.equal(aHora(r[3].estimada), '10:45');
});

test('proximosViajes y proximasSalidas: no ofrecen un tren que ya ha pasado por tu estación', () => {
  const vivo = new Map([['1|R1', ['1', 'R1', 600, 'C', 0]]]); // va por C: ya pasó por B
  assert.equal(proximosViajes(DIA, 'B', 'D', 10 * 60 + 5, vivo).length, 0);
  assert.equal(proximasSalidas(DIA, 'B', 10 * 60 + 5, vivo).some((s) => s.tren === '1'), false);
});
