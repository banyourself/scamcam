# Cost model

Budget: **$0 per month.** The domain is an existing expense. Limits below are from Cloudflare and GitHub
documentation checked on 2026-10-05; re-check before launch.

## Free allowances

| Service | Free limit | What happens at the limit | ScamCam's planned use |
|---|---|---|---|
| Workers requests | 100,000 per day | Error 1027 (route can fail closed); no charge | Only `/api/*` counts. Static pages are free and unlimited |
| Workers CPU | 10 ms per request | Request fails | Deterministic checks are cheap; heavy parsing stays bounded |
| Subrequests | 50 per request | Request fails | At most about 8 provider calls per scan |
| Cron triggers | 5 per account | Cannot add more | ScamCam uses 2 |
| Workers Logs | 200,000 events per day, kept 3 days | Logging stops | One log line per API request |
| D1 | 5 million rows read and 100,000 written per day; 500 MB per database | Queries error until 00:00 UTC; inserts blocked when full | Writes only for errors, maintenance, and cached indicators |
| KV | 100,000 reads and 1,000 writes per day | That operation fails | Not used yet |
| Workers AI | 10,000 neurons per day | Calls fail; not billed on Free | Optional, inconclusive cases only, Stage 4 |
| Turnstile | Unlimited challenges, 20 widgets | n/a | One widget |
| Rate limiting binding | No plan restriction or price found | | 60 API requests and 10 scans per minute per client |
| GitHub Actions | 2,000 minutes per month for private repos on Free (3,000 on Pro) | Blocked if no payment method | About 3 minutes per push |
| GitHub Codespaces | 120 core hours and 15 GB-month (180 and 20 on Pro) | Blocked if no payment method | Optional |

## Cost of one scan (Stage 3)

| Resource | Per scan | Free limit and headroom |
|---|---|---|
| Worker requests | 1 (`POST /api/v1/scans`), plus 1 health check per page load | 100,000 per day |
| Subrequests | At most 12: Turnstile 1, Safe Browsing 1 (all links in one call), URLhaus up to 3, RDAP up to 3 (plus the IANA bootstrap once per 12 hours per instance), DNS up to 3 | 50 per request |
| D1 reads | 1 (the `writes_paused` flag) | 5 million per day |
| D1 writes | Up to 4 (1 Safe Browsing count, up to 3 URLhaus counts), only when those keys are set | 100,000 per day, so about 25,000 fully checked scans a day |
| Safe Browsing calls | 1, capped by `SAFE_BROWSING_DAILY_LIMIT` (8,000) | Google Cloud quota |
| URLhaus calls | Up to 3, capped by `URLHAUS_DAILY_LIMIT` (5,000) | Fair use |
| CPU | About 0.8 ms of local analysis measured in Node | 10 ms per request on Free; verify after deployment |

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
That is an operating rule for this project.
