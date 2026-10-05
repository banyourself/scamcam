CREATE TABLE error_events (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  route TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX error_events_expires_at ON error_events (expires_at);

CREATE TABLE maintenance_runs (
  id INTEGER PRIMARY KEY,
  task TEXT NOT NULL CHECK (task IN ('daily', 'weekly')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  detail_json TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX maintenance_runs_expires_at ON maintenance_runs (expires_at);
CREATE INDEX maintenance_runs_task_started_at ON maintenance_runs (task, started_at);

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
