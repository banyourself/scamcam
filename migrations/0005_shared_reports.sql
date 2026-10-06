CREATE TABLE shared_reports (
  id TEXT PRIMARY KEY,
  iv BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX shared_reports_expires_at ON shared_reports (expires_at);
