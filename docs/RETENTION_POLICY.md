# Retention policy

This is ScamCam's written retention schedule (also required by the 2025 COPPA amendments if they apply).

| Data | Kept for | Where enforced |
|---|---|---|
| Submitted message text | Not stored | Scan request handling; verified by a test that inspects every table |
| Raw submitted URLs | Not stored | Scan request handling; verified by the same test |
| Shared reports (only when a visitor presses Share) | 5, 10, or 15 minutes as chosen, then deleted within 5 minutes; encrypted with a key that only the link holds | `shared_reports.expires_at`, a cleanup every 5 minutes, and the read refuses expired rows |
| Result flags (only when a visitor flags a result) | 30 days, or until reviewed with `npm run flags -- --done <id>`; holds the verdict, finding IDs, the domain or file fingerprint, the reason, and the redacted note | `result_flags.expires_at`, daily cleanup |
| IP addresses | Not stored by ScamCam | Rate limiter and Turnstile are Cloudflare services |
| Temporary scan jobs (if introduced) | 1 hour at most | `expires_at` plus daily cleanup |
| Abuse-prevention data | 24 hours at most | Not stored in D1 today; the rate limiter keeps short-lived counters |
| Application error records | 7 days | `error_events.expires_at`, daily cleanup |
| Maintenance run records | 90 days | `maintenance_runs.expires_at`, daily cleanup |
| Provider call counts (no content, one row per provider per day) | 35 days | `provider_usage.expires_at`, daily cleanup |
| Provider answers (Safe Browsing, URLhaus, RDAP, DNS, security DNS, Spamhaus, PhishStats, Cloudflare Radar) | The source's rule: Google's `cacheDuration`, 15 minutes, 1 to 24 hours, or the DNS TTL (at least 5 minutes for security DNS); Spamhaus 1 minute, PhishStats 6 hours, Radar 1 day | Scanner or Worker memory and Cache API expiry, with a stored expiry time checked on every read; Safe Browsing answers and everything in the scanner stay in memory only |
| Files a visitor checks | Never uploaded or stored | The browser sends only fingerprints and finding codes; a test checks that no name or content reaches any server |
| File lookup answers (MalwareBazaar, CIRCL hashlookup, Team Cymru, Modrinth) | 15 minutes to 1 day, in the scanner's memory only, under hashed keys | Scanner memory |
| AI answers (one label) | 1 hour, in memory only | Worker memory |
| Passwords checked on /breaches | Never sent or stored; only 5 characters of the fingerprint leave the device | The browser |
| Pwned Passwords ranges (public answers for a 5-character prefix) | 1 day | Cache API expiry, with a stored expiry time checked on every read |
| Have I Been Pwned breach list (public data) | Replaced after 12 hours when someone opens the list; used for at most 7 days; 6 hours at the edge | Scanner storage (one key) and Cache API expiry |
| Scam list copies (hashed keys): Phishing.Database, MetaMask, ScamSniffer, PhishDestroy, DevSpen, CERT Polska, and the FTC's reported phone numbers (the last 30 days of reports) | Replaced daily; not used once the source data is too old (30 days for Phishing.Database, 7 for the other GitHub lists, 3 for CERT Polska, 10 for the FTC list, 365 for DevSpen's rarely updated list); deleted 10 days after the last sync | `domain_lists.expires_at`, `domain_list_shards.expires_at`, daily cleanup |
| Threat intelligence cache | Provider-defined expiry (for example Safe Browsing `cacheDuration`) | Cache API, see provider answers above |
| Verified first-party indicators | Reviewed at least every 30 days | `review_after` column (planned with the `threat_indicators` table) |
| Worker logs | 3 days (Cloudflare Workers Logs on Free); ScamCam's own events only, with invocation logs off | Cloudflare |
| D1 point-in-time recovery | 7 days (Cloudflare Time Travel on Free) | Cloudflare; deleted data can be restored for 7 days |

Data may be kept longer only when a source's license, an active security investigation, or the law requires it.
Any exception is recorded in `STATUS.md`.

## Automatic cleanup

| Schedule (UTC) | Task |
|---|---|
| Daily 03:17 | Delete expired rows in batches of 500 (at most 26 batches per run, shared across tables), check database size, set or clear `writes_paused`, flag maintenance runs stuck for over 6 hours |
| Weekly Monday 04:41 | Count rows per table, count rows missing a valid expiry, check database size, check every scam list, count flags waiting for review |

Cleanup uses indexed `expires_at` lookups and bounded batches so it stays well inside the free D1 limits.
