# Roadmap

Each stage ends with tests, a security review, and an update to `BUILD_STATE.md`. Later stages do not start
until the current one is evaluated.

| Stage | Status | Contents |
|---|---|---|
| 0. Planning | Done | Requirements, free-tier and license research, architecture, threat model, data model, retention, costs, legal and naming risks |
| 1. Foundation | Done locally | Repository, React and TypeScript, Worker with Hono, D1 migrations, security headers, error handling, rate limiting, Turnstile helper, scheduled cleanup, logging, CI, Codespaces |
| 2. Website | Next | Design system, landing page, scan form, report layout, accessibility pass, Privacy, Terms, Acceptable Use, Cookie, Accessibility, Security, Vulnerability Disclosure, and Contact pages |
| 3. Detection | Planned | Safe Browsing v5, URLhaus, Phishing.Database, RDAP, DNS, Public Suffix List, URL and message analysis, gaming impersonation rules, evidence correlation, structured reports |
| 4. Optimization | Planned | Caching under each provider's rules, safe deduplication, benchmarks, optional Workers AI for inconclusive cases |
| 5. Security and compliance | Planned | Security testing, privacy verification, rate-limit tests, legal review of drafts, disclosure process test, cleanup and recovery test |
| 6. Deployment | Needs approval | Create D1 in Cloudflare, set secrets, deploy, attach `scamcam.kevinle.tech`, verify the personal site is unaffected, trademark check |

## Decisions Kevin needs to make before Stage 6

1. Approve creating Cloudflare resources: one Worker named `scamcam` and one D1 database named `scamcam`.
2. Approve attaching `scamcam.kevinle.tech` as a Worker Custom Domain (Cloudflare creates that one DNS record).
3. Create a Turnstile widget for `scamcam.kevinle.tech` and set its secret with `wrangler secret put`.
4. Create a Google Cloud API key for Safe Browsing (free, noncommercial) and an abuse.ch Auth-Key.
5. Decide whether to keep the name ScamCam after the trademark search (see `COMPLIANCE_MATRIX.md`).

## Later phases

Protect (browser extension, Discord app), Verify, and Intelligence (public API). All free and noncommercial, all
reusing the same analysis engine, all following each platform's policies.
