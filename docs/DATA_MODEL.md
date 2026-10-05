# Data model

All times are Unix seconds (`INTEGER`). Tables are `STRICT`. Every table that can grow has an `expires_at` column
and an index on it so cleanup is a cheap indexed delete. SQL lives only in `src/worker/repositories`, so the store
can move to PostgreSQL later without touching routes.

## Current tables (migration `0001_foundation.sql`)

| Table | Purpose | Key columns | Retention |
|---|---|---|---|
| `error_events` | Count failures by type and route | `code`, `route`, `created_at`, `expires_at` | 7 days |
| `maintenance_runs` | Record every daily and weekly task | `task`, `status`, `detail_json`, `started_at`, `finished_at`, `expires_at` | 90 days |
| `app_state` | Small operational flags, such as `writes_paused` when storage passes the soft limit | `key`, `value`, `updated_at` | Overwritten in place |

## Planned tables

Created only when the stage that needs them starts, so no unused tables exist.

| Table | Stage | Purpose | Uniqueness | Retention |
|---|---|---|---|---|
| `threat_indicators` | 3 | Cached public indicators: registrable domains and keyed URL hashes with a verdict and source | `UNIQUE (indicator_type, indicator_value, source)`, idempotent upserts | Provider-defined expiry; first-party entries reviewed every 30 days |
| `provider_usage` | 3 | Daily call counts per provider to enforce budgets | `UNIQUE (provider, day)` | 35 days |
| `scan_jobs` | Only if scans become asynchronous | Temporary job status and result | Primary key | 1 hour |
| `voluntary_reports` | Later | User-submitted "this is a scam" or "this was misflagged" reports | Fingerprint per indicator | 7 days unless reviewed |

## Rules

- Never store raw submitted messages, raw URLs, IP addresses, or AI conversations.
- URL indicators are stored as keyed hashes (HMAC with a server secret) so a database copy cannot reveal what
  someone checked, except registrable domains already listed by a public source.
- `detail_json` holds counts and statuses only, never content.
- Target under 100 MB of data in Stage 3 and 4; the soft limit that pauses optional writes is 80 MB
  (`STORAGE_SOFT_LIMIT_BYTES`).
