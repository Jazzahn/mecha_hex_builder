-- Run once against your Neon database to set up the rooms registry.
-- Game state lives in Durable Object memory; Neon handles room metadata and rate limiting.

CREATE TABLE IF NOT EXISTS rooms (
  code           CHAR(6)     PRIMARY KEY,
  max_points     INTEGER     NOT NULL DEFAULT 200,
  created_by_ip  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '3 hours'
);

CREATE TABLE IF NOT EXISTS games (
  id          BIGSERIAL   PRIMARY KEY,
  room_code   CHAR(6)     NOT NULL,
  winner_name TEXT,
  ended_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast IP rate-limit lookups
CREATE INDEX IF NOT EXISTS idx_rooms_ip_created ON rooms (created_by_ip, created_at);

-- Periodic cleanup (run via pg_cron or a scheduled Neon query):
-- DELETE FROM rooms WHERE expires_at < now();
