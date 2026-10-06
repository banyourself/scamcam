# Cost model

Budget: **$0 per month.** The domain is an existing expense. Limits below are from Cloudflare and GitHub
documentation checked on 2026-10-05; re-check before launch.

## Free allowances

| Service | Free limit | What happens at the limit | ScamCam's planned use |
|---|---|---|---|
| Workers requests | 100,000 per day | Error 1027 (route can fail closed); no charge | Only `/api/*` counts. Static pages are free and unlimited |
| Workers CPU | 10 ms per request | Request fails | The Worker only checks the rate limit and Turnstile and calls the scanner; the scan itself runs in a Durable Object |
| Durable Objects (SQLite-backed only on Free) | 100,000 requests and 13,000 GB-s of duration a day; 30 seconds of CPU per request | That operation fails, and the Worker scans by itself instead | One request per scan, about 0.13 GB-s for a 1-second scan, so roughly 100,000 scans a day. Nothing is stored |
| Subrequests | 50 per request (and per cron run); outside fetches, D1 queries, and Cache API calls all count | That call fails | At most 43 per scan (measured with 20 links and every source on), 6.7 on average for the benchmark; daily cleanup under 35 |
| Cron triggers | 5 per account | Cannot add more | ScamCam uses 2 |
| Workers Logs | 200,000 events per day, kept 3 days | Logging stops | One log line per API request |
| D1 | 5 million rows read and 100,000 written per day; 500 MB per database; 50 queries per Worker invocation | Queries error until 00:00 UTC; inserts blocked when full | Writes only for errors, maintenance, provider counts, and the list; at most 9 queries per scan |
| KV | 100,000 reads and 1,000 writes per day | That operation fails | Not used yet |
| Workers AI | 10,000 neurons per day on Free and Paid | Calls fail on Free; billed at $0.011 per 1,000 neurons on Paid | Unclear messages only, capped at 2,000 calls a day (about 4,300 neurons at 2.14 per call, under 6,400 even with the longest messages) |
| Turnstile | Unlimited challenges, 20 widgets | n/a | One widget |
| Rate limiting binding | No plan restriction or price found | | 60 API requests and 10 scans per minute per client |
| GitHub Actions | 2,000 minutes per month for private repos on Free (3,000 on Pro) | Blocked if no payment method | About 3 minutes per push, plus about 2 minutes a day for the Phishing.Database sync once enabled |
| GitHub Codespaces | 120 core hours and 15 GB-month (180 and 20 on Pro) | Blocked if no payment method | Optional |

## Cost of one scan (measured in October 2026)

| Resource | Per scan | Free limit and headroom |
|---|---|---|
| Worker requests | 1 (`POST /api/v1/scans`), plus 1 health check per page load | 100,000 per day |
| Subrequests | At most 15: Turnstile 1, Safe Browsing 1 (all links in one call), URLhaus up to 3, RDAP up to 3 (plus the IANA bootstrap once per 12 hours per instance), DNS up to 3, and Cloudflare's security DNS up to 3 | 50 per request |
| D1 reads | 3 (the `writes_paused` flag, the list record, and one list shard) | 5 million per day |
| D1 writes | Up to 5 (Safe Browsing, up to 3 URLhaus, and the AI count), only for calls that are actually made | 100,000 per day, so about 20,000 fully checked scans a day |
| Cache API | At most 24 shared cache reads and writes per request; repeated lookups in the same Worker instance come from memory | Counts toward the 50 subrequests |
| All subrequests | 44 for a message with 20 links in the Worker fallback (15 fetches, 20 cache calls, 9 queries); 24 in the scanner, which caches in memory only; none for a repeat in the same instance | 50 per request |
| Workers AI | At most 1 call (about 2.1 neurons), only for messages the rules cannot decide | 10,000 neurons per day; ScamCam stops at 2,000 calls |
| Safe Browsing calls | 1, capped by `SAFE_BROWSING_DAILY_LIMIT` (8,000) | Google Cloud quota |
| URLhaus calls | Up to 3, capped by `URLHAUS_DAILY_LIMIT` (5,000) | Fair use |
| CPU | 1.2 ms at the median and 2.9 ms at the 95th percentile for the benchmark in Node (with a fake network), and under 1 ms for each of the worst crafted inputs. Live scans on a fresh Worker used 9 to 26 ms, which is why scans moved to the scanner | 30 seconds per request in the scanner; 10 ms for the Worker's own part |

Per-visitor limits: 60 API requests and 10 scans per minute. Turnstile is required for every scan.

## Billing risks and controls

| Risk | Control |
|---|---|
| Upgrading to Workers Paid ($5 per month minimum) | Never upgrade. Stay on Free, where overages become errors |
| Paid add-ons (Advanced Rate Limiting, R2, extra certificates) | Do not enable. R2 is not used |
| A payment method on Cloudflare or GitHub | Keep none, or set GitHub budgets to $0 |
| Paid-only Workers AI models | Use only models available on Free; treat a 403 as "AI unavailable" |
| Quotas exhausted by abuse | Rate limiting, Turnstile, per-provider daily budgets, cached results |

## Degradation order when limits are near

1. Skip optional checks (certificate history, AI).
2. Serve cached or deterministic results only.
3. Disable AI entirely.
4. Limit new scans and show "ScamCam is busy right now. Try again later." with no false result.

Zero cost cannot be guaranteed by code alone; it depends on never adding a payment method or upgrading a plan.
That is an operating rule in `CONTRIBUTING.md`.
