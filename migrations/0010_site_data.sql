CREATE TABLE site_data (
  dataset TEXT PRIMARY KEY CHECK (dataset IN ('site-security', 'breach-notices')),
  version TEXT NOT NULL CHECK (length(version) = 16),
  parts INTEGER NOT NULL CHECK (parts BETWEEN 1 AND 100),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  built_at INTEGER NOT NULL
) STRICT;

CREATE TABLE site_data_parts (
  dataset TEXT NOT NULL CHECK (dataset IN ('site-security', 'breach-notices')),
  version TEXT NOT NULL CHECK (length(version) = 16),
  part INTEGER NOT NULL CHECK (part >= 0),
  body TEXT NOT NULL,
  PRIMARY KEY (dataset, version, part)
) STRICT;
