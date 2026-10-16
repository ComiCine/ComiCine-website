-- Limooo observability: shared event table (docs/06).
-- Apply with: wrangler d1 execute limooo --file=./migrations/003_events.sql
-- The health-check script also creates this table idempotently through the D1 API on first run.

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event       TEXT    NOT NULL,
    ts          INTEGER NOT NULL DEFAULT (unixepoch()),
    request_id  TEXT    DEFAULT '',
    host        TEXT    DEFAULT '',
    path        TEXT    DEFAULT '',
    method      TEXT    DEFAULT '',
    status      INTEGER DEFAULT 0,
    outcome     TEXT    DEFAULT '',
    ip_hash     TEXT    DEFAULT '',
    country     TEXT    DEFAULT '',
    duration_ms INTEGER DEFAULT 0,
    message     TEXT    DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_events_ts_event ON events (ts, event);
CREATE INDEX IF NOT EXISTS idx_events_event_outcome_ts ON events (event, outcome, ts);
CREATE INDEX IF NOT EXISTS idx_events_request_id ON events (request_id);
