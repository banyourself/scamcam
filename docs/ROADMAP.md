# Roadmap

Every feature ships with tests, a security review, and updates to [STATUS.md](STATUS.md) and
[CHANGELOG.md](../CHANGELOG.md). A new phase starts only after the current one is stable and evaluated.

## Live now

| Feature | Live since | Contents |
|---|---|---|
| Foundation | 2026-10-05 | Requirements, free-tier and license research, architecture, threat model, data model, retention, costs, legal and naming risks, then the repository, React and TypeScript, a Worker with Hono, D1 migrations, security headers, error handling, rate limiting, a Turnstile helper, scheduled cleanup, logging, CI, and Codespaces |
| Website and design | 2026-10-05 | Evidence-room design system, landing page with a gaming scam guide, scan panel with a live in-browser link and redaction preview, report layout, How it works, Privacy, Terms, Acceptable use, Cookies, Accessibility, Security, Vulnerability disclosure, and Contact pages, and an automated WCAG 2.2 AA audit |
| Detection engine | 2026-10-05 | Public Suffix List, URL and message analysis, gaming impersonation rules, Safe Browsing v5, URLhaus, RDAP, DNS, evidence correlation, structured reports, and a scan endpoint with Turnstile |
| Caching and the Phishing.Database list | 2026-10-05 | Caching under each provider's rules, safe deduplication, paused failing sources and registry back-off, and a daily hashed copy of Phishing.Database |
| AI step | 2026-10-05 | A free Workers AI model for messages the rules cannot decide, mapped to the OWASP Top 10 for LLM Applications 2026 |
| Security hardening | 2026-10-05 | Review against the OWASP API Top 10 and ASVS with 11 findings fixed, Workers Free plan limits enforced by tests, privacy checks in a real browser and in the Worker, monitoring alerts, a recovery runbook and backup drill, and researched answers to the open legal questions ([SECURITY_REVIEW.md](SECURITY_REVIEW.md), [RECOVERY.md](RECOVERY.md)) |
| Public launch | 2026-10-05 | Live at `scamcam.kevinle.tech` on Cloudflare's free plan, Phishing.Database sync on, policies published, live checks passing, personal site unaffected |
| Screenshot reading | 2026-10-06 | Screenshots are read in the visitor's browser (Tesseract.js for text, jsQR for QR codes) and never uploaded, with strict file checks against fake images and decompression bombs |
| Share links | 2026-10-06 | Opt-in links that work for 5, 10, or 15 minutes, encrypted with a key only the link holds, signed reports only, message text only when ticked |

## Next

### After launch

1. Bring scans with links under the Free plan's CPU limit for good (see [STATUS.md](STATUS.md#open-items)).
2. Watch the first daily and weekly maintenance reports for alerts ([RECOVERY.md](RECOVERY.md)).
3. Close the three rule gaps from the held-out benchmark with a fresh sample from the list.

The other open items, including the CPU time measurement on the Free plan, are in [STATUS.md](STATUS.md#open-items).

### Later phases

The website is the first of four phases in [PROJECT_SPEC.md](PROJECT_SPEC.md#long-term-phases):

1. **Scan**: the website (live now).
2. **Protect**: a browser extension and a Discord app reusing the same engine.
3. **Verify**: authorized identity verification and evidence-based transaction safety.
4. **Intelligence**: a free threat intelligence API for communities and compatible tools.

All of them stay free and noncommercial, reuse the same analysis engine, and follow each platform's policies.
