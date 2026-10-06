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
| 6. Deployment | Done, live on 2026-10-05 | D1 created, Worker deployed to `scamcam.kevinle.tech`, secrets set by Kevin, Phishing.Database sync on, policies published, live checks passing, personal site unaffected (see `BUILD_STATE.md`) |
| 7. Screenshots | Done, live on 2026-10-06 | Screenshots are read in the visitor's browser (Tesseract.js for text, jsQR for QR codes) and never uploaded; strict file checks against fake images and decompression bombs; security review in `SECURITY_REVIEW.md` |
| 8. Share links | Done, live on 2026-10-06 | Opt-in links that work for 5, 10, or 15 minutes, encrypted with a key only the link holds, signed reports only, message text only when ticked |

## After launch

1. Run one real scan by hand, since Turnstile does not finish in a headless browser.
2. Watch the first daily and weekly maintenance reports for alerts (`RECOVERY.md`).
3. Close the three rule gaps from the held-out benchmark with a fresh sample from the list.
4. Add the Live Minutes Turnstile widget to minutes.kevinle.tech.

## Later phases

Protect (browser extension, Discord app), Verify, and Intelligence (public API). All free and noncommercial, all
reusing the same analysis engine, all following each platform's policies.
