-- Base de datos D1 "rodalies". Aplicar con:
--   npx wrangler d1 execute rodalies --remote --file colector/schema.sql

-- Una fila por minuto: el estado de todos los trenes de Rodalies en ese momento.
CREATE TABLE IF NOT EXISTS capturas (
  ts INTEGER PRIMARY KEY,  -- marca de tiempo del feed de Renfe (segundos UNIX)
  trenes TEXT NOT NULL     -- JSON: [[tren, línea, retraso_s, próxima_parada, cancelado], …]
);

-- Avisos de Renfe que afectan a Rodalies, guardados una vez cada uno.
CREATE TABLE IF NOT EXISTS avisos (
  id TEXT PRIMARY KEY,
  visto INTEGER NOT NULL,  -- cuándo lo vio el colector por primera vez (s UNIX)
  inicio INTEGER,          -- periodo activo según Renfe (s UNIX)
  fin INTEGER,
  lineas TEXT,             -- "R2,R2N,R2S"
  texto TEXT
);

-- Resumen por tren y día de servicio (el día va de 3:00 a 3:00 en Madrid). Lo va sumando el colector cada
-- hora con las capturas nuevas; las capturas en crudo se borran a los 8 días y esto se queda.
CREATE TABLE IF NOT EXISTS resumen (
  fecha TEXT NOT NULL,       -- AAAA-MM-DD
  tren TEXT NOT NULL,
  linea TEXT NOT NULL,
  primera INTEGER,           -- primera y última vez que se vio (s UNIX)
  ultima INTEGER,
  retraso_max INTEGER,       -- segundos
  retraso_final INTEGER,     -- el último retraso visto (≈ al llegar al final)
  suma INTEGER NOT NULL DEFAULT 0,  -- suma de retrasos observados y cuántos: medio = suma / n
  n INTEGER NOT NULL DEFAULT 0,
  cancelado INTEGER NOT NULL DEFAULT 0,
  paradas TEXT NOT NULL DEFAULT '{}',  -- {"71801": 300, …}: retraso al llegar a cada estación
  PRIMARY KEY (fecha, tren, linea)
);
CREATE INDEX IF NOT EXISTS resumen_linea ON resumen (linea, fecha);

-- Por dónde va el resumen (ts de la última captura sumada).
CREATE TABLE IF NOT EXISTS progreso (clave TEXT PRIMARY KEY, valor INTEGER);
