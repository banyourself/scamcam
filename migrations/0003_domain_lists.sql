CREATE TABLE domain_lists (
  list TEXT PRIMARY KEY CHECK (list IN ('phishing_database')),
  version TEXT NOT NULL,
  entries INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX domain_lists_expires_at ON domain_lists (expires_at);

CREATE TABLE domain_list_shards (
  list TEXT NOT NULL CHECK (list IN ('phishing_database')),
  shard INTEGER NOT NULL CHECK (shard >= 0 AND shard < 1024),
  version TEXT NOT NULL,
  entries INTEGER NOT NULL,
  hashes BLOB NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (list, shard)
) STRICT;

CREATE INDEX domain_list_shards_expires_at ON domain_list_shards (expires_at);
