CREATE TABLE provider_usage (
  provider TEXT NOT NULL CHECK (provider IN ('safe_browsing', 'urlhaus')),
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (provider, day)
) STRICT;

CREATE INDEX provider_usage_expires_at ON provider_usage (expires_at);
