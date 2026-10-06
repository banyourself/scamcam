CREATE TABLE provider_usage_next (
  provider TEXT NOT NULL CHECK (provider IN ('safe_browsing', 'urlhaus', 'workers_ai')),
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (provider, day)
) STRICT;

INSERT INTO provider_usage_next (provider, day, calls, expires_at)
SELECT provider, day, calls, expires_at FROM provider_usage;

DROP TABLE provider_usage;

ALTER TABLE provider_usage_next RENAME TO provider_usage;

CREATE INDEX provider_usage_expires_at ON provider_usage (expires_at);
