# Roadmap

Each stage ends with tests, a security review, and an update to `BUILD_STATE.md`. Later stages do not start
until the current one is evaluated.

| Stage | Status | Contents |
|---|---|---|
| 0. Planning | Done | Requirements, free-tier and license research, architecture, threat model, data model, retention, costs, legal and naming risks |
| 1. Foundation | Done locally | Repository, React and TypeScript, Worker with Hono, D1 migrations, security headers, error handling, rate limiting, Turnstile helper, scheduled cleanup, logging, CI, Codespaces |
| 2. Website | Done locally | Evidence-room design system, landing page with gaming scam guide, scan panel with live in-browser link and redaction preview, report layout, How it works, draft Privacy, Terms, Acceptable Use, and Cookie pages, Accessibility, Security, Vulnerability Disclosure, and Contact pages, automated WCAG 2.2 AA audit |
| 3. Detection | Done locally | Public Suffix List, URL and message analysis, gaming impersonation rules, RDAP, DNS, evidence correlation, structured reports, scan endpoint with Turnstile; Safe Browsing v5 and URLhaus connected and verified live locally; Phishing.Database moved to Stage 4 |
| 4. Optimization | Done locally | Caching under each provider's rules, safe deduplication, paused failing sources and registry back-off, Phishing.Database sync (ready, switched on at deployment), a free Workers AI step for messages the rules cannot decide, performance and AI benchmarks; the held-out domain benchmark waits for permission to download the list |
| 5. Security and compliance | Done locally | Security review against the OWASP API Top 10 and ASVS with 11 findings fixed, Workers Free plan limits (CPU and subrequests) measured and enforced by tests, privacy checks in a real browser and in the Worker, IPv6 and concurrency rate-limit tests, monitoring alerts, cleanup limits, a recovery runbook and backup drill, policy drafts reviewed with questions for a lawyer, disclosure contact checked (see `SECURITY_REVIEW.md` and `RECOVERY.md`) |
| 6. Deployment | Next, needs approval | Create D1 in Cloudflare, set secrets, deploy, attach `scamcam.kevinle.tech`, verify the personal site is unaffected, trademark check |

## Decisions Kevin needs to make before Stage 6

1. Approve creating Cloudflare resources: one Worker named `scamcam` and one D1 database named `scamcam`.
2. Approve attaching `scamcam.kevinle.tech` as a Worker Custom Domain (Cloudflare creates that one DNS record).
3. Create a Turnstile widget for `scamcam.kevinle.tech` and set its secret with `wrangler secret put`.
4. Done on 2026-10-05: Kevin created the Safe Browsing API key and the abuse.ch Auth-Key, and both work locally. For
   production, Kevin sets them with `npx wrangler secret put`.
5. Decide whether to keep the name ScamCam after the trademark search (see `COMPLIANCE_MATRIX.md`).
6. Switch on the Phishing.Database sync: create a Cloudflare API token limited to D1 Edit, add it as the GitHub secret
   `CLOUDFLARE_D1_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`, and set the repository variable `PHISHING_DATABASE_SYNC` to
   `enabled` (see `DEPLOYMENT.md`).
7. Done on 2026-10-05: a test security report from an outside Gmail address arrived at kevin@kevinle.tech, and the
   reply reached the Gmail inbox.
8. Done on 2026-10-05: instead of a lawyer, Kevin asked for researched answers to the open legal questions. They are
   in `COMPLIANCE_MATRIX.md`, and the pages were updated to match. The draft labels come off and the effective date
   is set at launch.

## Later phases

Protect (browser extension, Discord app), Verify, and Intelligence (public API). All free and noncommercial, all
reusing the same analysis engine, all following each platform's policies.
