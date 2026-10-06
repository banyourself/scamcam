# Data model

All times are Unix seconds (`INTEGER`). Tables are `STRICT`. Every table that can grow has an `expires_at` column
and an index on it so cleanup is a cheap indexed delete. SQL lives only in `src/worker/repositories`, so the store
can move to PostgreSQL later without touching routes.

## Current tables

| Table | Purpose | Key columns | Retention |
|---|---|---|---|
| `error_events` | Count failures by type and route | `code`, `route`, `created_at`, `expires_at` | 7 days |
| `maintenance_runs` | Record every daily and weekly task | `task`, `status`, `detail_json`, `started_at`, `finished_at`, `expires_at` | 90 days |
| `app_state` | Small operational flags, such as `writes_paused` when storage passes the soft limit | `key`, `value`, `updated_at` | Overwritten in place |
| `provider_usage` (migrations `0002` and `0004`) | Daily call counts for quota-limited providers (`safe_browsing`, `urlhaus`, `workers_ai`) | `PRIMARY KEY (provider, day)`, idempotent upsert | 35 days |
| `domain_lists` (migration `0003`) | One record per synced list: version (source commit), entry count, sync time | `list` primary key | 7 days after the last sync |
| `shared_reports` (migration `0005`) | Encrypted reports that a visitor chose to share | `id` (128 random bits), `iv`, `ciphertext` (AES-GCM; the key is only in the link), `created_at`, `expires_at` | 5, 10, or 15 minutes; deleted by a cleanup every 5 minutes |
| `domain_list_shards` (migration `0003`) | Sorted 8-byte SHA-256 keys of listed domains, 1,024 rows per list | `PRIMARY KEY (list, shard)`, replaced in place by each sync | 7 days after the last sync |

The `Scanner` Durable Object is declared with a SQLite storage backend, the only kind the Free plan allows, but it
writes nothing there. Its lookup cache lives in memory.

## Planned tables

Created only when the feature that needs them is built, so no unused tables exist.

| Table | When | Purpose | Uniqueness | Retention |
|---|---|---|---|---|
| `threat_indicators` | Only if first-party indicators are added | ScamCam's own reviewed indicators. Provider answers are cached in the Cache API instead, so they cost no D1 writes | `UNIQUE (indicator_type, indicator_value, source)`, idempotent upserts | Reviewed every 30 days |
| `scan_jobs` | Only if scans become asynchronous | Temporary job status and result | Primary key | 1 hour |
| `voluntary_reports` | Later | User-submitted "this is a scam" or "this was misflagged" reports | Fingerprint per indicator | 7 days unless reviewed |

## Rules

- Never store raw submitted messages, raw URLs, IP addresses, or AI conversations.
- URL indicators are stored as keyed hashes (HMAC with a server secret) so a database copy cannot reveal what
  someone checked, except registrable domains already listed by a public source.
- `detail_json` holds counts and statuses only, never content.
- Target under 100 MB of data for the detection engine and caching; the soft limit that pauses optional writes is 80 MB
  (`STORAGE_SOFT_LIMIT_BYTES`).
