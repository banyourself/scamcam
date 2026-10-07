# ScamCam

**Check the Scan.** I built ScamCam, a free and noncommercial website that tells you whether a link, a message, or a
screenshot of one is a scam, and shows you the evidence behind the answer.

**Live at [scamcam.kevinle.tech](https://scamcam.kevinle.tech)** since October 5, 2026.

ScamCam started with the scams that target gamers: fake Steam trade links, "free Nitro" gifts, "I accidentally
reported you" scripts, and "can you test my game?" malware on Discord, Roblox, and Minecraft. Those scams rely on
people not knowing what to look for, so every report explains what ScamCam found in plain language.

## What it does

Paste a suspicious link or message, drop in a screenshot, or pick a file someone sent you, and ScamCam returns a
report with:

- a risk level, from **confirmed malicious** to **no known threat detected**, always written in words,
- the evidence behind it, with the independent source for each finding,
- how sure it is, and which checks it could not run,
- what to do next.

A clean result never means "safe". It means none of the sources knew of a problem when they were checked, and the
report says so.

Files are checked without being uploaded: the browser looks inside the file and sends only its fingerprints. Saved
emails (.eml) are read on the device too, so email addresses and attachments never leave it.

Reports can be shared with a link that expires after 5, 10, or 15 minutes. The link holds the decryption key, so
ScamCam itself cannot read what was shared.

Every report also links to other well-known checkers, such as VirusTotal, Google's Safe Browsing site status,
urlscan.io, and Cisco Talos, so a visitor can compare answers. ScamCam does not send them anything; they only see the
domain or fingerprint if the visitor clicks.

If a result looks wrong, the visitor can flag it. A flag goes into a queue I review by hand and never changes any
result, so flagging a scam site over and over cannot make it look safe.

## How a scan works

1. **Read the input.** Links are pulled out of the text, invisible characters are stripped, and emails, phone
   numbers, and codes are redacted before any check sees the message. US phone numbers are compared only with
   scrambled copies of the FTC's and FCC's lists of numbers people reported for unwanted calls, and wallet addresses
   with ScamSniffer's list of scam wallets, all kept in ScamCam's own database, so neither ever leaves ScamCam. Screenshots are read on the visitor's own device with
   Tesseract.js and jsQR, so the image is never uploaded.
2. **Check the links.** Look-alike and disguised addresses (other alphabets, misspellings, the `@` trick, brand names
   on the wrong domain), free hosting, short links, IP loggers, downloads, and endings that are abused far more than
   most. Links that only pass through a redirect, such as Steam's link filter, a Google redirect, or an email
   scanner's safe link, are decoded so the real destination is checked. Link text that shows one address but opens
   another, like Discord's `[rockstargames.com](https://another-site.example)` trick, is flagged, and a link read from
   a screenshot never counts as official, because a picture cannot show where a link really goes.
3. **Ask independent sources.** Google Safe Browsing, Spamhaus's Domain Blocklist and its list of domains first seen
   in the last 24 hours, PhishStats, Cloudflare's 1.1.1.2 security filter, abuse.ch URLhaus and ThreatFox, RDAP registry
   data for domain age, and DNS. Six scam lists are checked against a hashed copy I keep in the database, so links
   never leave ScamCam for them: Phishing.Database, MetaMask's phishing list, ScamSniffer, PhishDestroy, a
   public-domain list of Discord and Steam scam links, and CERT Polska's warning list. Very popular domains in
   Cloudflare Radar's ranking only soften small warnings, such as an often-abused ending, and never outweigh a real
   listing. Discord invites are checked with Discord (server age, verification, names that pretend to be staff) and
   Steam profiles and trade links with the Steam Web API (trade bans, new accounts, names that pretend to be staff).
   Lookups are passive: ScamCam never opens a submitted link.
4. **Check the message.** Rules for the scripts scammers use, such as login code requests, QR code logins, cookie
   theft, fake "verify you are human" steps that make you paste a command, crypto wallet drainers, fake middlemen,
   fake staff, payment pressure, vote scams, and fake order or voicemail texts that push you to call a number. A
   message that names Steam or Discord but links somewhere else is flagged too.
5. **Check files on the device.** A file's real type comes from its contents, not its name, and the browser looks
   for disguised endings, macros, PDF actions, fake login pages, and programs inside archives. Its SHA-256 and SHA-1
   fingerprints are looked up in MalwareBazaar, CIRCL hashlookup, and Team Cymru's Malware Hash Registry, and the
   report links to VirusTotal, Hybrid Analysis, and Cisco Talos for the visitor to open themselves, because
   VirusTotal's terms do not allow showing its results to others.
6. **AI only as a last resort.** If the rules and sources cannot decide, a small open model (Qwen3 on Workers AI)
   labels the message. Its answer counts as one warning sign, never as proof. The message is passed as untrusted
   data, and messages that try to talk to checkers or AI models are flagged instead of being sent to it.
7. **Weigh the evidence.** Independent sources count more than a single rule, contradictions lower the confidence,
   and confirmed listings outrank everything else.

## Privacy and security

- **Files never leave the device.** The browser reads a file without opening or running it, and only its
  fingerprints, size, type, and fixed finding codes are sent, never the file or its name.
- **Nothing is kept.** Submitted messages and links are checked and discarded. A report is stored only if someone
  chooses to share it, and then only encrypted, for at most 15 minutes. A flagged result keeps only the verdict, the
  names of the findings, and the domain or file fingerprint, for 30 days, never the message or the full link.
- **Keys stay private.** Every outside key lives in Cloudflare's secret store, never in the code or the browser.
  Spamhaus lookups go through Cloudflare's own DNS over HTTPS resolver with the question in the request body, so the
  access key never appears in an address or in ScamCam's logs.
- **No accounts, trackers, ads, or analytics scripts.** ScamCam's own pages and API set no cookies.
- **Abuse resistant.** Cloudflare Turnstile, per-visitor rate limits, strict input validation, daily budgets for
  every outside source, and signed reports so nobody can share a fake "this is safe" result under ScamCam's name.
  Flags need their own bot check, only work on a report ScamCam signed in the last day, are capped per visitor and per
  day, and are never read by the scan engine.
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

## License

ScamCam's code is released under the [GNU Affero General Public License v3.0 or later](LICENSE). Anyone can use,
study, and change it, and anyone who runs a modified version for other people has to share their changes under the
same license. The threat data ScamCam checks belongs to its providers and keeps their own terms, listed in
[docs/API_LICENSE_MATRIX.md](docs/API_LICENSE_MATRIX.md). Domain popularity comes from Cloudflare Radar under CC BY-NC
4.0.

## About

I'm Kevin Le. ScamCam is my project: I designed it, built it, and run it. It is free, has no sponsors, and will stay
that way. A naming and trademark review is in
[docs/COMPLIANCE_MATRIX.md](docs/COMPLIANCE_MATRIX.md#name-and-trademark).
