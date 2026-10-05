# Retention policy

This is ScamCam's written retention schedule (also required by the 2025 COPPA amendments if they apply).

| Data | Kept for | Where enforced |
|---|---|---|
| Submitted message text | Not stored | Request handling (Stage 3) |
| Raw submitted URLs | Not stored | Request handling (Stage 3) |
| IP addresses | Not stored by ScamCam | Rate limiter and Turnstile are Cloudflare services |
| Temporary scan jobs (if introduced) | 1 hour at most | `expires_at` plus daily cleanup |
| Abuse-prevention data | 24 hours at most | Not stored in D1 today; the rate limiter keeps short-lived counters |
| Application error records | 7 days | `error_events.expires_at`, daily cleanup |
| Maintenance run records | 90 days | `maintenance_runs.expires_at`, daily cleanup |
| Unreviewed voluntary reports | 7 days | Later stage |
| Threat intelligence cache | Provider-defined expiry (for example Safe Browsing `cacheDuration`) | `threat_indicators.expires_at` (Stage 3) |
| Verified first-party indicators | Reviewed at least every 30 days | `review_after` column (Stage 3) |
| Worker logs | 3 days (Cloudflare Workers Logs on Free) | Cloudflare |
| D1 point-in-time recovery | 7 days (Cloudflare Time Travel on Free) | Cloudflare; deleted data can be restored for 7 days |

Data may be kept longer only when a source's license, an active security investigation, or the law requires it.
Any exception is recorded in `BUILD_STATE.md`.

## Automatic cleanup

| Schedule (UTC) | Task |
|---|---|
| Daily 03:17 | Delete expired rows in batches of 500 (at most 20 batches per table per run), check database size, set or clear `writes_paused`, flag maintenance runs stuck for over 6 hours |
| Weekly Monday 04:41 | Count rows per table, count rows missing a valid expiry, check database size |

Cleanup uses indexed `expires_at` lookups and bounded batches so it stays well inside the free D1 limits.
