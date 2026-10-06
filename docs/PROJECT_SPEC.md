# Project specification

## Purpose

Answer one question for ordinary people: **"Can I trust this link, message, website, or interaction?"** with an
evidence-based, understandable assessment.

## Audience

Gamers first (Steam, Discord, Roblox, Minecraft, gaming marketplaces), including teenagers. The design must work
for people with no security background and for minors (see `PRIVACY_DESIGN.md`).

## Non-negotiable constraints

| Constraint | Meaning |
|---|---|
| Free and noncommercial | No ads, subscriptions, sponsorships, premium features, or paid API. Ever. |
| $0 operating cost | Only free plans with hard limits. See `COST_MODEL.md`. |
| Cloud only | Nothing runs on Kevin's computer. Development works in a browser through GitHub Codespaces. |
| Evidence first | Deterministic checks and threat intelligence before AI. AI is optional. |
| Privacy | No accounts for scanning, no trackers, no stored messages or raw URLs. |
| Separate project | No changes to Kevin's personal website, DNS, Pages, R2, or secrets without approval. |
| Honest results | Never present "not found in a database" as "safe". Always show sources and uncertainty. |

## Phase 1 scope (ScamCam Scan)

In scope, in this order:
1. URL analysis: parsing, normalization, registrable domain, punycode and homograph checks.
2. Message analysis: link extraction, scam-pattern rules, urgency and authority signals.
3. Gaming impersonation detection (lookalike Steam, Discord, Roblox, Minecraft domains and narratives).
4. Domain reputation: Google Safe Browsing v5, URLhaus, Phishing.Database, RDAP domain age, DNS records.
5. Evidence correlation and an explainable report with sources, confidence, and recommendations.

Out of scope for Phase 1: screenshots, QR codes, file scanning, sandboxing, malware execution, accounts, community
reporting, browser extension, Discord bot, identity verification, public API.

## Risk levels

| Level | Used when |
|---|---|
| Listed as malicious | A trusted source lists this exact URL or domain as malicious now |
| High risk | Strong independent signals agree (for example a fresh lookalike of steamcommunity.com plus a credential request) |
| Suspicious | Some signals, no confirmation |
| Unknown | Not enough evidence either way, or sources were unavailable |
| No known threat detected | Checks ran and found nothing; always shown with "this does not prove it is safe" |

Wording follows the rules in `COMPLIANCE_MATRIX.md` (hedged, signal-based language, dated, sourced, disputable).

## Success measures

Precision, recall, false-positive and false-negative rates on a labeled benchmark; median and p95 latency; external
API calls per scan; storage per day; cost (must stay $0). Targets are set in `SCAMCAM_ANALYSIS.md` after the first
benchmark run.

## Long-term phases

1. **Scan**: the website (current).
2. **Protect**: browser extension and Discord integration reusing the same engine.
3. **Verify**: authorized identity verification and evidence-based transaction safety.
4. **Intelligence**: a free threat intelligence API for communities and compatible tools.

Each later phase starts only after the previous one is stable and evaluated.
