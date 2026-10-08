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
| `provider_usage` (migrations `0002`, `0004`, and `0006`) | Daily call counts for quota-limited providers (`safe_browsing`, `urlhaus`, `workers_ai`, `phishstats`) | `PRIMARY KEY (provider, day)`, idempotent upsert | 35 days |
| `domain_lists` (migrations `0003`, `0006`, `0007`, and `0008`) | One record per synced list (`phishing_database`, `metamask`, `scamsniffer`, `phishdestroy`, `scam_links`, `cert_polska`, the phone lists `ftc_dnc` and `fcc_complaints`, and the wallet list `scamsniffer_wallets`): version (source commit or date), entry count, upstream data date (`synced_at`) | `list` primary key with a `CHECK` on the nine names | 10 days after the last sync; `expires_at` minus 10 days is when it was last refreshed |
| `shared_reports` (migration `0005`) | Encrypted reports that a visitor chose to share | `id` (128 random bits), `iv`, `ciphertext` (AES-GCM; the key is only in the link), `created_at`, `expires_at` | 5, 10, or 15 minutes; deleted by a cleanup every 5 minutes |
| `domain_list_shards` (migrations `0003`, `0006`, `0007`, and `0008`) | Sorted 8-byte SHA-256 keys of listed domains, of phone numbers as `+1` and 10 digits for the phone lists, or of lowercase `0x` wallet addresses, 1,024 rows per list | `PRIMARY KEY (list, shard)`, replaced in place by each sync | 10 days after the last sync |
| `result_flags` (migration `0006`) | Results a visitor flagged for review | `id` (128 random bits), `report_key` (unique: the first 16 bytes of SHA-256 of the report signature, so one flag per report), `case_number`, `kind`, `level`, `subject` (domain or file SHA-256), `evidence` (finding IDs), `reason` (`CHECK` on four values), `note` (at most 300 characters), `created_at`, `expires_at` | 30 days, or until reviewed. Never read by the scan engine |
| `site_data` and `site_data_parts` (migration `0010`) | The current version of each public data set the site lookup uses (`site-security` and `breach-notices`), as base64 of a gzip-compressed JSON file split into 60,000-character parts | `dataset`, `version` (first 16 hex characters of the file's SHA-256), `parts`, `bytes`, `built_at`; parts keyed by (`dataset`, `version`, `part`) | Replaced by each daily build; the previous version's parts are deleted after the switch. No visitor data |

The `Scanner` Durable Object is declared with a SQLite storage backend, the only kind the Free plan allows. It keeps
one key there, `breach-catalog`: the compact copy of Have I Been Pwned's public breach list (about 191 KB, under the 2
MB value limit), replaced after 12 hours. Its lookup cache lives in memory.

## Planned tables

Created only when the feature that needs them is built, so no unused tables exist.

| Table | When | Purpose | Uniqueness | Retention |
|---|---|---|---|---|
| `threat_indicators` | Only if first-party indicators are added | ScamCam's own reviewed indicators. Provider answers are cached in the Cache API instead, so they cost no D1 writes | `UNIQUE (indicator_type, indicator_value, source)`, idempotent upserts | Reviewed every 30 days |
| `scan_jobs` | Only if scans become asynchronous | Temporary job status and result | Primary key | 1 hour |

## Rules

- Never store raw submitted messages, raw URLs, IP addresses, or AI conversations.
- URL indicators are stored as keyed hashes (HMAC with a server secret) so a database copy cannot reveal what
  someone checked, except registrable domains already listed by a public source.
- `detail_json` holds counts and statuses only, never content.
- Target under 100 MB of data for the detection engine and caching; the soft limit that pauses optional writes is 80 MB
  (`STORAGE_SOFT_LIMIT_BYTES`).
