# Security

## Reporting a vulnerability

Email **kevin@kevinle.tech** with "ScamCam security" in the subject. Include what you found, how to reproduce it,
and what an attacker could do with it. You will get a reply within 7 days.

The machine-readable contact is at `/.well-known/security.txt` (RFC 9116).

### Authorized testing

You may test `scamcam.kevinle.tech` when it is live, as long as you:

- only use your own test data and never access, change, or delete other people's data,
- keep request rates low and stop if you notice degraded service,
- do not use social engineering, physical attacks, or denial of service,
- do not test third-party services ScamCam relies on (Cloudflare, Google, abuse.ch, registries),
- give a reasonable time to fix the issue before sharing details publicly.

Good-faith research that follows these rules will not be met with legal action. This policy is based on the
disclose.io templates (CC0) and is a draft pending review.

Out of scope: missing headers that have no security impact, reports from automated scanners without a working
proof, rate limits on purpose-built endpoints, and anything on `kevinle.tech` outside the ScamCam subdomain.

## Controls in place

| Area | Control |
|---|---|
| Transport | HTTPS only through Cloudflare, HSTS on every response |
| Browser | Strict CSP with no inline scripts or styles, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, COOP and CORP same-origin |
| API | Zod validation, JSON-only errors with no internal details, 16 KB body limit, cross-site form posts rejected, no CORS, `Cache-Control: no-store` |
| Abuse | Rate limits of 60 API requests and 10 scans per minute per visitor, with IPv6 visitors grouped by /64, through the Workers rate limiting binding (which counts per Cloudflare location and is eventually consistent); Turnstile verification on every scan that fails closed when it is not configured; daily provider budgets counted exactly for the whole service |
| Errors | Users see a generic message and a request ID made by the Worker; the database records only the error type and route for 7 days |
| Logging | Only fixed fields are logged (route, status, timing, the AI's label and size, maintenance reports, alerts). Cloudflare's per-request invocation logs are off. No IP addresses, messages, or links |
| Platform limits | Every request stays within the Workers Free plan: parsing time grows in step with input length (under 1 ms for the worst crafted inputs), and a 20-link scan uses 43 of the 50 subrequests. Both are tested |
| Provider answers | Read with size caps (64 KB to 1 MB), time limits, and schemas; links to a provider must be that provider's own `https` pages |
| Monitoring | Daily and weekly reports with alerts for usage near the daily budgets, storage, failed or stuck runs, cleanup backlog, errors, and a stale list |
| Recovery | Runbook in [docs/RECOVERY.md](docs/RECOVERY.md); a backup and restore drill runs in CI |
| Secrets | Never committed; `wrangler secret` in production and an ignored `.dev.vars` locally; Gitleaks runs in CI |
| Dependencies | Exact versions with a lockfile, `npm audit` and `npm audit signatures` in CI, a CycloneDX SBOM from every CI run, Dependabot weekly, and every GitHub Action pinned to a commit (enforced by a test) |
| Data | No raw URLs, messages, or IP addresses are stored (see `docs/RETENTION_POLICY.md`); a test scans every table after a scan to prove it |
| Caching | Provider answers are kept in Worker memory and a named cache under SHA-256 keys (Safe Browsing in memory only), follow each provider's freshness rules, and are never written for failures |
| AI | Runs only for messages the rules cannot decide, sees redacted text without links or invisible characters, treats the message as untrusted data, accepts one known label, can add a warning but never lower a result, is skipped when the message contains text aimed at checkers, is capped at 2,000 calls a day, pauses after three failures, and does not run when its usage cannot be counted. Mapped to the OWASP Top 10 for LLM Applications 2026 in `docs/OWASP_LLM_TOP_10.md` |
| Screenshots | Read in the visitor's browser and never uploaded; only real PNG, JPEG, WebP, and GIF files up to 10 MB and 40 megapixels; no SVG; OCR in a worker with time limits; OCR files self-hosted and pinned. See [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md#stage-7-screenshot-reading-2026-10-06) |
| Hidden characters | Zero-width characters, tag characters, variation selectors, and direction controls are removed before analysis and display; their presence inside words or links, or as direction tricks, is reported as a warning |
| Scanning | Turnstile required for every scan (fails closed when missing or unreachable), 10 scans per minute per visitor, submitted links are never fetched, outbound calls go only to fixed provider hosts with timeouts, input limited to 4,000 characters, the report is validated against its schema before it is returned, and only domain names or hash prefixes leave ScamCam |

The threat model is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#threat-model). The Stage 5 review, with
its findings, fixes, and the OWASP API Security Top 10 and ASVS mapping, is in
[docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md). `npm run test:privacy` checks requests, cookies, storage, and
headers in a real browser and scans the build for secrets.
