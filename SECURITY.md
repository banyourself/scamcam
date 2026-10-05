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

## Controls in place (Stage 1)

| Area | Control |
|---|---|
| Transport | HTTPS only through Cloudflare, HSTS on every response |
| Browser | Strict CSP with no inline scripts or styles, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, COOP and CORP same-origin |
| API | Zod validation, JSON-only errors with no internal details, 16 KB body limit, cross-site form posts rejected, no CORS, `Cache-Control: no-store` |
| Abuse | Per-client rate limit (60 requests per minute) through the Workers rate limiting binding, Turnstile verification that fails closed when it is not configured |
| Errors | Users see a generic message and a request ID; the database records only the error type and route for 7 days |
| Secrets | Never committed; `wrangler secret` in production and an ignored `.dev.vars` locally; Gitleaks runs in CI |
| Dependencies | Exact versions with a lockfile, `npm audit` in CI, Dependabot weekly |
| Data | No raw URLs, messages, or IP addresses are stored (see `docs/RETENTION_POLICY.md`) |

The threat model is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#threat-model).
