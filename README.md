# Observatorio de puntualidad de Rodalies

Guardar el tiempo real de Renfe minuto a minuto para tener el histórico de retrasos que nadie publica:
qué línea, tramo y hora fallan más, "¿llegará tarde mi tren?" y ayuda para reclamar.
Destino: **https://rodalies.reloda.es**.

Estado: **el colector funciona desde el 20/10/2026** y guarda cada minuto el estado de todos los trenes
de Rodalies. La web muestra las salidas de cada estación con su retraso real y la puntualidad por línea.

## Datos

Feeds GTFS-RT públicos de Renfe, en JSON y sin registro (comprobado el 20/10/2026):

| Feed | URL | Tamaño |
|---|---|---|
| Retrasos por viaje | `https://gtfsrt.renfe.com/trip_updates.json` | ~156 KB, ~380 viajes de todas las redes |
| Posiciones de trenes | `https://gtfsrt.renfe.com/vehicle_positions.json` | ~143 KB |
| Avisos | `https://gtfsrt.renfe.com/alerts.json` | ~100 KB |

Traen **todas las redes de Cercanías** juntas, pero el identificador ya dice cuál es cuál:

- Viaje `5191M28289R2S` → red `5191` (Rodalies de Catalunya), tren `28289`, línea `R2S`.
- Ruta en los avisos `51T0244R3` → Rodalies (`51T`), línea `R3`.

Con eso basta para filtrar Rodalies sin el GTFS estático (que hará falta más adelante para los horarios
previstos y los nombres de las paradas).

## Arquitectura (0 €, sin tarjeta)

```
Cada minuto (cron)                       D1 "rodalies"
Worker rodalies-colector  ─────────────> capturas  1 fila por minuto (se borran a los 8 días)
  · lee trip_updates.json                avisos    1 fila por aviso de Rodalies
  · cada 10 min, alerts.json             resumen   1 fila por tren y día (se queda)
  · cada hora, suma las capturas
    nuevas al resumen
                                                     ▲
Web rodalies.reloda.es (Cloudflare Pages)            │
  public/            estática + horarios en datos/   │
  functions/api/     /api/ahora (última captura) ────┤
                     /api/lineas (puntualidad) ──────┘
```

- **Colector** (`colector/`): cada captura guarda `[tren, línea, retraso_s, próxima_parada, cancelado]`
  de cada tren: unos **2,8 KB por minuto**. Si Renfe no ha actualizado el feed, no se duplica nada.
- **Resumen por hora** en lugar de una compactación nocturna: recorrer un día entero con SQL leería
  ~2 millones de filas (casi la mitad del cupo diario gratuito de D1). Sumando cada hora las ~60
  capturas nuevas cuesta ~60 lecturas y ~120 escrituras, y el resumen está siempre al día.
- **Horarios** (`npm run horarios`): el GTFS de Renfe se convierte en archivos estáticos por día
  (`web/public/datos/horarios/AAAA-MM-DD.json`, ~350 KB, ~60 KB comprimido). No gastan peticiones ni D1.
  El GTFS trae unas 4 semanas: **hay que regenerarlos y volver a publicar la web cada 2–3 semanas.**
  El viaje de hoy en el GTFS se llama igual que en el tiempo real (`5191M28289R2S`).
- **Peticiones de Workers**: el colector gasta 1.440 al día de las 100.000 gratuitas; la web, ~2 por
  visita y 1 por minuto mientras está abierta (las APIs se cachean en Cloudflare).
- **D1** en lugar de R2, porque R2 pide tarjeta para activarse.

Comprobar el colector: `https://rodalies-colector.dimelo-game.workers.dev/estado`.

## Uso

```bash
npm install
npm test
npm run horarios               # regenera los horarios desde el GTFS de Renfe
npm run desplegar:web          # regenera los horarios y publica la web (rodalies-reloda)
npm run desplegar:colector     # publica el colector
npx wrangler d1 execute rodalies --remote --file colector/schema.sql    # crea las tablas (una vez)
```

## Plan

1. [x] Colector cada minuto en D1
2. [x] Horarios del GTFS estático como archivos de la web
3. [x] Resumen por tren y día (cada hora) y borrado del crudo a los 8 días
4. [x] Web en rodalies.reloda.es: panel de salidas de tu estación y puntualidad por línea
5. [ ] "Mi tren": historial de un tren concreto (¿suele llegar tarde el de las 8:12?)
6. [ ] Mapa en directo, predicción por tramo, ayuda para reclamar
