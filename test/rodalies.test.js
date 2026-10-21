import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerAvisos, extraerTrenes } from '../colector/src/rodalies.js';

test('se queda solo con los trenes de Rodalies y los compacta', () => {
  const feed = {
    header: { timestamp: '1792492030' },
    entity: [
      { tripUpdate: { trip: { tripId: '5191M28289R2S', scheduleRelationship: 'SCHEDULED' }, delay: 660,
        stopTimeUpdate: [{ arrival: { delay: 660, time: '1792492339' }, stopId: '71708' }] } },
      { tripUpdate: { trip: { tripId: '3091M23522C1', scheduleRelationship: 'SCHEDULED' }, delay: 480,
        stopTimeUpdate: [{ stopId: '50703' }] } },
      { tripUpdate: { trip: { tripId: '5191M15001R11', scheduleRelationship: 'CANCELED' } } },
      { tripUpdate: { trip: { tripId: '5192X77524R4', scheduleRelationship: 'SCHEDULED' }, // otro día de servicio
        stopTimeUpdate: [{ arrival: { delay: 120 }, stopId: '72205' }] } },
    ],
  };
  assert.deepEqual(extraerTrenes(feed), {
    ts: 1792492030,
    trenes: [
      ['15001', 'R11', null, null, 1],
      ['28289', 'R2S', 660, '71708', 0],
      ['77524', 'R4', 120, '72205', 0],
    ],
  });
});

test('se queda con los avisos de Rodalies y sus líneas', () => {
  const feed = {
    entity: [
      { id: 'AVISO_1', alert: {
        activePeriod: [{ start: '1791357780' }],
        informedEntity: [{ routeId: '51T0244R3' }, { routeId: '51T0015R3' }, { routeId: '51T0059R2N' }],
        descriptionText: { translation: [{ text: 'Obras entre Vic y Ripoll', language: 'es' }] },
      } },
      { id: 'AVISO_2', alert: { informedEntity: [{ routeId: '10T0011C4' }], descriptionText: { translation: [{ text: 'Madrid' }] } } },
    ],
  };
  assert.deepEqual(extraerAvisos(feed), [
    { id: 'AVISO_1', inicio: 1791357780, fin: null, lineas: ['R2N', 'R3'], texto: 'Obras entre Vic y Ripoll' },
  ]);
});
