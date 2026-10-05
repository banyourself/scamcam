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
| Rate limiting binding | No plan restriction or price found | | 60 requests per minute per client |
| GitHub Actions | 2,000 minutes per month for private repos on Free (3,000 on Pro) | Blocked if no payment method | About 3 minutes per push |
| GitHub Codespaces | 120 core hours and 15 GB-month (180 and 20 on Pro) | Blocked if no payment method | Optional |

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
