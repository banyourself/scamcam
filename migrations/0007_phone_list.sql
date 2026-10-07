CREATE TABLE domain_lists_next (
  list TEXT PRIMARY KEY CHECK (list IN ('phishing_database', 'metamask', 'scamsniffer', 'phishdestroy', 'scam_links', 'cert_polska', 'ftc_dnc')),
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
  list TEXT NOT NULL CHECK (list IN ('phishing_database', 'metamask', 'scamsniffer', 'phishdestroy', 'scam_links', 'cert_polska', 'ftc_dnc')),
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
