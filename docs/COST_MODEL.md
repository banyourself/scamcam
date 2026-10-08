# Cost model

Budget: **$0 per month.** The domain is an existing expense. Limits below are from Cloudflare and GitHub
documentation checked on 2026-10-05; re-check before launch.

## Free allowances

| Service | Free limit | What happens at the limit | ScamCam's planned use |
|---|---|---|---|
| Workers requests | 100,000 per day | Error 1027 (route can fail closed); no charge | Only `/api/*` counts. Static pages are free and unlimited |
| Workers CPU | 10 ms per request | Request fails | The Worker only checks the rate limit and Turnstile and calls the scanner; the scan itself runs in a Durable Object |
| Durable Objects (SQLite-backed only on Free) | 100,000 requests and 13,000 GB-s of duration a day; 30 seconds of CPU per request | That operation fails, and the Worker scans by itself instead | One request per scan, about 0.13 GB-s for a 1-second scan, so roughly 100,000 scans a day. Nothing is stored |
| Subrequests | 50 per request (and per cron run); outside fetches, D1 queries, and Cache API calls all count | That call fails | At most 39 per scan in the Worker fallback and 38 in the scanner (measured with 20 links, including two Discord invites, two Steam profiles, two Bitly links, and a GitHub repository, and every source on), 6.7 on average for the benchmark; daily cleanup under 35 |
| Cron triggers | 5 per account | Cannot add more | ScamCam uses 3 |
| Workers Logs | 200,000 events per day, kept 3 days | Logging stops | One log line per API request |
| D1 | 5 million rows read and 100,000 written per day; 500 MB per database; 50 queries per Worker invocation | Queries error until 00:00 UTC; inserts blocked when full | Writes only for errors, maintenance, provider counts, flags (at most 200 a day), and the nine lists (1,025 rows each, but D1 also counts every index entry it writes, so a daily sync writes about 28,000 rows, roughly 12 MB stored in all; the sync skips any list refreshed in the last 20 hours, after three manual syncs and a table rebuild reached 98,630 of the 100,000 rows on 2026-10-07); at most 9 queries per scan in the Worker and 14 in the scanner |
| KV | 100,000 reads and 1,000 writes per day | That operation fails | Not used yet |
| Workers AI | 10,000 neurons per day on Free and Paid | Calls fail on Free; billed at $0.011 per 1,000 neurons on Paid | Unclear messages only, capped at 2,000 calls a day. Measured at 2.14 neurons per call (about 4,300 a day at the cap) before the label list grew by about 225 tokens on 2026-10-07; at Qwen3's input price that adds about 1 neuron per call, so even the longest messages stay near 8,500 a day at the cap. I will confirm the new figure from the `ai_review` logs |
| Turnstile | Unlimited challenges, 20 widgets | n/a | One widget |
| Rate limiting binding | No plan restriction or price found | | 60 API requests, 10 scans, 10 share links, and 3 flags per minute per client |
| GitHub Actions | 2,000 minutes per month for private repos on Free (3,000 on Pro) | Blocked if no payment method | About 3 minutes per push, plus about 1.5 minutes a day for the scam list sync of six lists (measured on 2026-10-07) |
| GitHub Codespaces | 120 core hours and 15 GB-month (180 and 20 on Pro) | Blocked if no payment method | Optional |

## Cost of one scan (measured in October 2026)

| Resource | Per scan | Free limit and headroom |
|---|---|---|
| Worker requests | 1 (`POST /api/v1/scans`), plus 1 health check per page load | 100,000 per day |
| Subrequests | At most 12: Turnstile 1, Safe Browsing 1 (all links in one call), URLhaus up to 3, RDAP up to 3 (plus the IANA bootstrap once per 12 hours per instance), and DNS through Cloudflare's security resolver up to 3 | 50 per request |
| D1 reads | About 20 rows in 2 list queries (six list records and one or two shards per list), plus the `writes_paused` flag | 5 million per day |
| D1 writes | Counts only for calls that are actually made: up to 5 in the Worker (Safe Browsing, up to 3 URLhaus, and the AI count) and up to 9 in the scanner (adding up to 3 ThreatFox and 1 PhishStats count). Counts that arrive together share one query, so the scanner needs at most 4 budget queries | 100,000 per day, so about 10,000 fully checked scans a day after the list sync |
| Cache API | At most 24 shared cache reads and writes per request; repeated lookups in the same Worker instance come from memory | Counts toward the 50 subrequests |
| All subrequests | 39 for a message with 20 links in the Worker fallback (12 fetches, 20 cache calls, 7 queries, one of them the anonymous totals counter); 29 in the scanner with every source on (17 fetches, 6 Spamhaus lookups, 6 queries), which caches in memory only and adds up to 3 ThreatFox lookups, 1 PhishStats lookup, up to 2 Radar lookups, up to 6 Spamhaus lookups, up to 2 Discord lookups, up to 4 Steam calls, up to 2 short link expansions, and up to 2 GitHub calls for one link (38 with two invites, two Steam profiles, two Bitly links, and a GitHub repository among 20 links); none for a repeat in the same instance | 50 per request |
| Workers AI | At most 1 call (about 2.1 neurons), only for messages the rules cannot decide | 10,000 neurons per day; ScamCam stops at 2,000 calls |
| Safe Browsing calls | 1, capped by `SAFE_BROWSING_DAILY_LIMIT` (8,000) | Google Cloud quota |
| abuse.ch calls | Up to 3 URLhaus and, in the scanner, up to 3 ThreatFox lookups, plus 1 MalwareBazaar lookup per file check, all counted in one abuse.ch budget, `URLHAUS_DAILY_LIMIT` (5,000) | Fair use |
| Spamhaus queries | In the scanner, up to 6 DNS over HTTPS lookups through Cloudflare's resolver (DBL and ZRD for up to 3 domains), answers kept for a minute | The free DQS allows under 100,000 queries a day, about 16,000 scans |
| PhishStats calls | In the scanner, at most 1 (the main link), cached for 6 hours, capped by `PHISHSTATS_DAILY_LIMIT` (140) and not made while D1 writes are paused | 150 a day on the free key |
| Cloudflare Radar calls | In the scanner, up to 2, cached for a day | Cloudflare's API allows 1,200 requests every 5 minutes per user |
| CPU | 1.2 ms at the median and 2.9 ms at the 95th percentile for the benchmark in Node (with a fake network), and under 1 ms for each of the worst crafted inputs. Live scans on a fresh Worker used 9 to 26 ms, which is why scans moved to the scanner | 30 seconds per request in the scanner; 10 ms for the Worker's own part |

Per-visitor limits: 60 API requests, 10 scans, 10 share links, and 3 flags per minute. Turnstile is required for every scan, file check, and flag.

## Cost of one flag

| Resource | Per flag | Limit |
|---|---|---|
| Worker requests | 1 (`POST /api/v1/flags`) | 100,000 per day |
| Subrequests | Turnstile 1, plus up to 3 D1 queries (the `writes_paused` flag, the insert with its daily cap, and a duplicate check when nothing was inserted) | 50 per request |
| D1 writes | 1 row | At most 200 a day (`FLAG_DAILY_LIMIT`) |

## Cost of one file check

| Resource | Per check | Limit |
|---|---|---|
| Worker requests | 1 (`POST /api/v1/files`) | 100,000 per day |
| Durable Object requests | 1 | 100,000 per day |
| Subrequests | At most 6: Turnstile 1, MalwareBazaar 1, CIRCL hashlookup 1, Team Cymru through Cloudflare DNS 1, and Modrinth up to 2 for a Minecraft mod (the file, then its project) or 1 for a modpack; none for a repeat while the answers are cached | 50 per request |
| D1 queries | Up to 2 (the `writes_paused` flag and the abuse.ch count) | 50 per request |
| MalwareBazaar calls | 1, counted in the same abuse.ch daily budget as URLhaus (`URLHAUS_DAILY_LIMIT`, 5,000) | Fair use |
| CPU | Hashing and parsing run in the visitor's browser; the server only builds the report | |

## Cost of one breach check

| Resource | Per check | Limit |
|---|---|---|
| Worker requests | 1 per password check (`GET /api/v1/passwords/range/{prefix}`) and 1 when the breach list is opened (`GET /api/v1/breaches`) | 100,000 per day |
| Subrequests | At most 3 for a password: a cache read, Pwned Passwords, and a cache write; none to Pwned Passwords for a prefix seen in the last day. At most 3 for the breach list: a cache read, the scanner, and a cache write | 50 per request |
| Durable Object requests | 1 when the edge has no copy of the breach list; the scanner downloads the list itself at most every 12 hours | 100,000 per day |
| Durable Object storage | One 191 KB value, written at most every 12 hours | 5 GB on Free |
| CPU | The SHA-1 fingerprint and the search run in the browser; the Worker checks the range's format and adds padding (well under 1 ms). Parsing the 1.1 MB list happens in the scanner, which has 30 seconds | |
| Rate limit | 20 password checks a minute per visitor (`PASSWORD_RATE_LIMITER`), inside the 60 API requests a minute | |

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
