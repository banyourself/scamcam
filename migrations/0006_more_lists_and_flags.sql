CREATE TABLE domain_lists_next (
  list TEXT PRIMARY KEY CHECK (list IN ('phishing_database', 'metamask', 'scamsniffer', 'phishdestroy', 'scam_links', 'cert_polska')),
  version TEXT NOT NULL,
  entries INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

INSERT INTO domain_lists_next (list, version, entries, synced_at, expires_at)
SELECT list, version, entries, synced_at, expires_at FROM domain_lists;

DROP TABLE domain_lists;

ALTER TABLE domain_lists_next RENAME TO domain_lists;

CREATE INDEX domain_lists_expires_at ON domain_lists (expires_at);

CREATE TABLE domain_list_shards_next (
  list TEXT NOT NULL CHECK (list IN ('phishing_database', 'metamask', 'scamsniffer', 'phishdestroy', 'scam_links', 'cert_polska')),
  shard INTEGER NOT NULL CHECK (shard >= 0 AND shard < 1024),
  version TEXT NOT NULL,
  entries INTEGER NOT NULL,
  hashes BLOB NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (list, shard)
) STRICT;

INSERT INTO domain_list_shards_next (list, shard, version, entries, hashes, expires_at)
SELECT list, shard, version, entries, hashes, expires_at FROM domain_list_shards;

DROP TABLE domain_list_shards;

ALTER TABLE domain_list_shards_next RENAME TO domain_list_shards;

CREATE INDEX domain_list_shards_expires_at ON domain_list_shards (expires_at);

CREATE TABLE provider_usage_next (
  provider TEXT NOT NULL CHECK (provider IN ('safe_browsing', 'urlhaus', 'workers_ai', 'phishstats')),
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

CREATE TABLE result_flags (
  id TEXT PRIMARY KEY CHECK (length(id) = 22),
  report_key TEXT NOT NULL UNIQUE CHECK (length(report_key) = 32),
  case_number TEXT NOT NULL CHECK (length(case_number) <= 32),
  kind TEXT NOT NULL CHECK (kind IN ('url', 'message', 'file')),
  level TEXT NOT NULL CHECK (level IN ('no_known_threat', 'unknown', 'suspicious', 'high_risk', 'confirmed_malicious')),
  subject TEXT CHECK (subject IS NULL OR length(subject) <= 253),
  evidence TEXT NOT NULL CHECK (length(evidence) <= 2000),
  reason TEXT NOT NULL CHECK (reason IN ('safe_but_warned', 'scam_but_missed', 'detail_wrong', 'other')),
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX result_flags_expires_at ON result_flags (expires_at);

CREATE INDEX result_flags_created_at ON result_flags (created_at);
