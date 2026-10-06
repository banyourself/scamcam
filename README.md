# ScamCam

**Check the Scan.** I built ScamCam, a free and noncommercial website that tells you whether a link, a message, or a
screenshot of one is a scam, and shows you the evidence behind the answer.

**Live at [scamcam.kevinle.tech](https://scamcam.kevinle.tech)** since October 5, 2026.

ScamCam started with the scams that target gamers: fake Steam trade links, "free Nitro" gifts, "I accidentally
reported you" scripts, and "can you test my game?" malware on Discord, Roblox, and Minecraft. Those scams rely on
people not knowing what to look for, so every report explains what ScamCam found in plain language.

## What it does

Paste a suspicious link or message, or drop in a screenshot, and ScamCam returns a report with:

- a risk level, from **confirmed malicious** to **no known threat detected**, always written in words,
- the evidence behind it, with the independent source for each finding,
- how sure it is, and which checks it could not run,
- what to do next.

A clean result never means "safe". It means none of the sources knew of a problem when they were checked, and the
report says so.

Reports can be shared with a link that expires after 5, 10, or 15 minutes. The link holds the decryption key, so
ScamCam itself cannot read what was shared.

## How a scan works

1. **Read the input.** Links are pulled out of the text, invisible characters are stripped, and emails, phone
   numbers, and codes are redacted before any check sees the message. Screenshots are read on the visitor's own device with
   Tesseract.js and jsQR, so the image is never uploaded.
2. **Check the links.** Look-alike and disguised addresses (other alphabets, misspellings, the `@` trick, brand names
   on the wrong domain), free hosting, short links, IP loggers, downloads, and endings that are abused far more than
   most. Links that only pass through a redirect, such as Steam's link filter, a Google redirect, or an email
   scanner's safe link, are decoded so the real destination is checked. Link text that shows one address but opens
   another, like Discord's `[rockstargames.com](https://another-site.example)` trick, is flagged, and a link read from
   a screenshot never counts as official, because a picture cannot show where a link really goes.
3. **Ask independent sources.** Google Safe Browsing, Cloudflare's 1.1.1.2 security filter, abuse.ch URLhaus, the
   Phishing.Database community list, RDAP registry data for domain age, and DNS. Lookups are passive: ScamCam never
   opens a submitted link.
4. **Check the message.** Rules for the scripts scammers use, such as login code requests, QR code logins, cookie
   theft, fake "verify you are human" steps that make you paste a command, crypto wallet drainers, fake middlemen,
   fake staff, payment pressure, and vote scams. A message that names Steam or Discord but links somewhere else is
   flagged too.
5. **AI only as a last resort.** If the rules and sources cannot decide, a small open model (Qwen3 on Workers AI)
   labels the message. Its answer counts as one warning sign, never as proof. The message is passed as untrusted
   data, and messages that try to talk to checkers or AI models are flagged instead of being sent to it.
6. **Weigh the evidence.** Independent sources count more than a single rule, contradictions lower the confidence,
   and confirmed listings outrank everything else.

## Privacy and security

- **Nothing is kept.** Submitted messages and links are checked and discarded. A report is stored only if someone
  chooses to share it, and then only encrypted, for at most 15 minutes.
- **No accounts, trackers, ads, or analytics scripts.** ScamCam's own pages and API set no cookies.
- **Abuse resistant.** Cloudflare Turnstile, per-visitor rate limits, strict input validation, daily budgets for
  every outside source, and signed reports so nobody can share a fake "this is safe" result under ScamCam's name.
- **Reviewed.** I mapped the API against the OWASP API Security Top 10 and ASVS, and the AI step against the OWASP
  Top 10 for LLM Applications 2026. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Running cost: $0

ScamCam runs entirely on Cloudflare's free plan and GitHub's free tier. The free plan gives a Worker only 10 ms of
CPU per request, so the Worker stays a thin front door (bot check, rate limits, signing) and the scan engine runs in a
Durable Object, which the free plan gives up to 30 seconds per request. If the scanner is ever unreachable, the
Worker runs the scan itself. Every source has a hard daily budget, and when one runs out the report says which check
was skipped instead of guessing. The limits and how ScamCam stays
inside them are in [docs/COST_MODEL.md](docs/COST_MODEL.md).

## Built with

React 19, TypeScript, Vite, and Tailwind CSS for the site. One Cloudflare Worker serves the static site and a Hono
API validated with Zod and documented with OpenAPI at `/api/v1/openapi.json`. Cloudflare D1 holds only short-lived
operational data. Every change runs type checks, the test suite (in Cloudflare's real runtime), an accessibility
audit, a privacy and header check, and a secret scan in GitHub Actions.

## Run it locally

Node 24 or newer, or open the repository in GitHub Codespaces.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`npm run check` runs the type checks, tests, and build. The project's standards are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

| Document | Contents |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | What shipped and when |
| [STATUS.md](docs/STATUS.md) | What is live, test results, and open items |
| [ROADMAP.md](docs/ROADMAP.md) | What is live and what comes next |
| [PROJECT_SPEC.md](docs/PROJECT_SPEC.md) | Requirements and scope |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design, technology decisions, and threat model |
| [SCAMCAM_ANALYSIS.md](docs/SCAMCAM_ANALYSIS.md) | How the detection engine weighs evidence, with benchmark results |
| [SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | Security review: findings, fixes, OWASP API Top 10 and ASVS mapping |
| [OWASP_LLM_TOP_10.md](docs/OWASP_LLM_TOP_10.md) | How the AI step covers the OWASP Top 10 for LLM Applications 2026 |
| [PRIVACY_DESIGN.md](docs/PRIVACY_DESIGN.md) | What data is processed and why |
| [RETENTION_POLICY.md](docs/RETENTION_POLICY.md) | How long anything is kept |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Database tables |
| [API_LICENSE_MATRIX.md](docs/API_LICENSE_MATRIX.md) | Threat intelligence sources and their terms |
| [COMPLIANCE_MATRIX.md](docs/COMPLIANCE_MATRIX.md) | Laws and standards that may apply |
| [COST_MODEL.md](docs/COST_MODEL.md) | Free-tier limits and cost controls |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | How ScamCam is deployed |
| [RECOVERY.md](docs/RECOVERY.md) | Recovery runbook, alerts, and the backup and restore drill |
| [TEST_PLAN.md](docs/TEST_PLAN.md) | What is tested and how |

## About

I'm Kevin Le. ScamCam is my project: I designed it, built it, and run it. It is free, has no sponsors, and will stay
that way. A naming and trademark review is in
[docs/COMPLIANCE_MATRIX.md](docs/COMPLIANCE_MATRIX.md#name-and-trademark).
