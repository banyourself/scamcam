# ScamCam

**Put scams in focus.** ScamCam is a free, noncommercial website for checking whether a link or message is a scam,
starting with the scams that target gamers on Steam, Discord, Roblox, and Minecraft.

Live at https://scamcam.kevinle.tech since October 5, 2026.

## What it will do

Paste a suspicious link or message, or a screenshot of it, and get a plain-language report that shows:

- the risk level (confirmed malicious, high risk, suspicious, unknown, or no known threat detected),
- the evidence behind it and which independent source said what,
- how sure ScamCam is, and what it could not check,
- what to do next.

A clean result never means a link is guaranteed safe. Screenshots are read on the visitor's device and never uploaded. A report can be shared with a link that works for 5, 10, or 15 minutes.

## Principles

- **Free for everyone.** No ads, subscriptions, sponsorships, premium tiers, or paid API.
- **Evidence first.** Real threat intelligence and deterministic checks before any AI.
- **Private by design.** Messages are processed and discarded. No accounts, trackers, or analytics.
- **$0 to run.** Cloudflare Free and GitHub Free, with hard limits instead of surprise bills.

## Status

Stages 0 to 6 are done: plan, foundation, website, detection, optimization, security and compliance, and
deployment. ScamCam is live on Cloudflare's free plan with every source connected, including Google Safe Browsing,
URLhaus, Phishing.Database, and a free AI step for unclear messages. See
[docs/BUILD_STATE.md](docs/BUILD_STATE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

React 19, TypeScript, Vite, Tailwind CSS, and shadcn/ui-style components for the site. One Cloudflare Worker serves
the static site and a Hono API validated with Zod and documented with OpenAPI. Cloudflare D1 stores only short-lived
operational data. Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

Works in GitHub Codespaces (the dev container installs everything) or locally with Node 24 or newer.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Run all checks with `npm run check`.

## Documentation

| Document | Contents |
|---|---|
| [PROJECT_SPEC.md](docs/PROJECT_SPEC.md) | Requirements and scope |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design, technology decisions, and threat model |
| [ROADMAP.md](docs/ROADMAP.md) | Stages and phases |
| [BUILD_STATE.md](docs/BUILD_STATE.md) | What exists, what works, test results |
| [COMPLETED_WORK.md](docs/COMPLETED_WORK.md) | Everything completed so far, stage by stage |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities and security controls |
| [SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | Stage 5 security review: findings, fixes, OWASP API Top 10 and ASVS mapping |
| [RECOVERY.md](docs/RECOVERY.md) | Recovery runbook, alerts, and the backup and restore drill |
| [PRIVACY_DESIGN.md](docs/PRIVACY_DESIGN.md) | What data is processed and why |
| [COMPLIANCE_MATRIX.md](docs/COMPLIANCE_MATRIX.md) | Laws and standards that may apply |
| [API_LICENSE_MATRIX.md](docs/API_LICENSE_MATRIX.md) | Threat intelligence sources and their terms |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Database tables |
| [RETENTION_POLICY.md](docs/RETENTION_POLICY.md) | How long anything is kept |
| [COST_MODEL.md](docs/COST_MODEL.md) | Free-tier limits and cost controls |
| [SCAMCAM_ANALYSIS.md](docs/SCAMCAM_ANALYSIS.md) | ScamCam Contextual Threat Analysis (SCTA) |
| [OWASP_LLM_TOP_10.md](docs/OWASP_LLM_TOP_10.md) | How the AI step covers the OWASP Top 10 for LLM Applications 2026 |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | How deployment will work, and what needs approval |
| [TEST_PLAN.md](docs/TEST_PLAN.md) | What is tested and how |

## Name

"ScamCam" is a provisional name. A trademark and naming review is in
[docs/COMPLIANCE_MATRIX.md](docs/COMPLIANCE_MATRIX.md#name-and-trademark).
