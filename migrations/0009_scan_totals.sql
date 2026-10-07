CREATE TABLE scan_totals (
  day TEXT NOT NULL CHECK (length(day) = 10),
  kind TEXT NOT NULL CHECK (kind IN ('url', 'message', 'file')),
  level TEXT NOT NULL CHECK (level IN ('no_known_threat', 'unknown', 'suspicious', 'high_risk', 'confirmed_malicious')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (day, kind, level)
) STRICT;

CREATE INDEX scan_totals_expires_at ON scan_totals (expires_at);
