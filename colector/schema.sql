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
