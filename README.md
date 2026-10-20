# Observatorio de puntualidad de Rodalies

Guardar el tiempo real de Renfe minuto a minuto para tener el histórico de retrasos que nadie publica:
qué línea, tramo y hora fallan más, "¿llegará tarde mi tren?" y ayuda para reclamar.
Destino: **https://rodalies.reloda.es**.

Estado: **el colector funciona desde el 20/10/2026** y guarda cada minuto el estado de todos los trenes
de Rodalies. La web viene después: el valor está en el histórico, y cada minuto que no se guarda se pierde.

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
Cada minuto (cron)                       Base de datos D1 "rodalies"
Worker rodalies-colector  ─────────────> capturas: 1 fila por minuto
lee trip_updates.json, se queda con      avisos:   1 fila por aviso de Rodalies
los ~100 trenes de Rodalies              (alerts.json, cada 10 minutos)
```

- **Colector** (`colector/`): cada captura guarda `[tren, línea, retraso_s, próxima_parada, cancelado]`
  de cada tren. Son unos **2,8 KB por minuto, ~4 MB al día**. Si Renfe no ha actualizado el feed, la
  marca de tiempo se repite y no se duplica nada.
- **D1** en lugar de R2: R2 pide tarjeta para activarse. El plan gratuito de D1 da para varios meses de
  capturas en crudo; antes de llegar al límite hay que añadir la compactación nocturna (resumen por tren y
  día, y borrar el crudo antiguo).
- **Peticiones**: el colector gasta 1.440 al día de las 100.000 gratuitas de Workers (las consultas a Renfe
  no cuentan). Si hiciera falta, cada 2 minutos serían 720.
- **Repositorio público**, para no gastar los minutos de GitHub Actions de los privados.

Comprobar que funciona: `https://rodalies-colector.dimelo-game.workers.dev/estado`.

## Uso

```bash
npm install
npm test
npm run desplegar:colector                                              # publica el Worker
npx wrangler d1 execute rodalies --remote --file colector/schema.sql    # crea las tablas (una vez)
npx wrangler d1 execute rodalies --remote --command "SELECT COUNT(*) FROM capturas"
```

## Plan

1. [x] Colector cada minuto en D1
2. [ ] GTFS estático: horarios previstos, nombres de paradas y orden de cada línea
3. [ ] Compactación nocturna: resumen por tren y día; borrar el crudo de hace más de una semana
4. [ ] Web en rodalies.reloda.es: "mi tren" y clasificación de líneas
5. [ ] Mapa en directo, predicción por tramo, ayuda para reclamar
