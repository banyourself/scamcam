# ScamCam

**Check the Scan.** I built ScamCam, a free and noncommercial website that tells you whether a link, a message, a
screenshot, an email, or a file is a scam, and shows you the evidence behind the answer.

**Live at [scamcam.kevinle.tech](https://scamcam.kevinle.tech)** since October 5, 2026.

ScamCam started with the scams that target gamers: fake Steam trade links, "free Nitro" gifts, "I accidentally
reported you" scripts, fake Minecraft mods, and "can you test my game?" malware on Discord, Roblox, and Minecraft. It
now also covers the scams that cost people the most and often come with no link at all, such as fake investments,
fake bank and government calls, fake tech support, job scams, and fake invoices. Those scams rely on people not
knowing what to look for, so every report explains what ScamCam found in plain language. It is meant for anyone who
cannot pay for a security product, and it will stay free.

## What it does

Paste a suspicious link or message, drop in a screenshot or a saved email, or pick a file someone sent you, and
ScamCam returns a report with:

- a risk level, from **listed as malicious** to **no known threat detected**, always written in words,
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

With the ScamCam extension for Edge and Chrome, people can right-click a link, a selected message, or a page and
choose Check with ScamCam. It opens the site with the text filled in and cannot read any page itself
([/extension](https://scamcam.kevinle.tech/extension)).

Reports that come back suspicious or worse end with Report it: a copy-ready summary and the right places to report
the scam. A public [Totals](https://scamcam.kevinle.tech/stats) page shows anonymous weekly and monthly counts, kept only
as daily counters of the input kind and result.

If a result looks wrong, the visitor can flag it. A flag goes into a queue I review by hand and never changes any
result, so flagging a scam site over and over cannot make it look safe.

## How a scan works

1. **Read the input.** Links are pulled out of the text, invisible characters are stripped, and emails, phone
   numbers, and codes are redacted before any check sees the message. US phone numbers are compared only with
   scrambled copies of the FTC's and FCC's lists of numbers people reported for unwanted calls, and wallet addresses
   with ScamSniffer's list of scam wallets, all kept in ScamCam's own database, so neither ever leaves ScamCam.
   Screenshots are read on the visitor's own device with Tesseract.js and jsQR, so the image is never uploaded.
2. **Check the links.** Look-alike and disguised addresses (other alphabets, misspellings, the `@` trick, brand names
   on the wrong domain or in front of someone else's, such as `steampowered.example-help.com`, and game names joined
   with words like gift, free, login, or verify), free hosting, IP loggers, downloads, and the 20 endings with the
   highest phishing rate for their size. Links that only pass through a redirect, such as Steam's link filter, a
   Google redirect, or an email scanner's safe link, are decoded so the real destination is checked. Bitly, is.gd,
   and v.gd short links are expanded by asking those services' own lookup APIs, never by opening the link. Link text
   that shows one address but opens another, like Discord's `[rockstargames.com](https://another-site.example)` trick,
   is flagged, and a link read from a screenshot never counts as official, because a picture cannot show where a link
   really goes.
3. **Ask independent sources.** Google Safe Browsing, Spamhaus's Domain Blocklist and its list of domains first seen
   in the last 24 hours, PhishStats, Cloudflare's 1.1.1.2 security filter, abuse.ch URLhaus and ThreatFox, RDAP registry
   data for domain age, and DNS. Six scam lists are checked against a hashed copy I keep in the database, so links
   never leave ScamCam for them: Phishing.Database, MetaMask's phishing list, ScamSniffer, PhishDestroy, a
   public-domain list of Discord and Steam scam links, and CERT Polska's warning list. Very popular domains in
   Cloudflare Radar's ranking only soften small warnings, such as an often-abused ending, and never outweigh a real
   listing. Discord invites are checked with Discord (server age, verification, names that pretend to be staff) and
   Steam profiles and trade links with the Steam Web API (trade bans, new accounts, names that pretend to be staff).
   Lookups are passive: ScamCam never opens a submitted link.
4. **Check the message.** 48 rules in 24 scam families cover the scripts scammers use: login code requests, QR code
   logins, cookie theft, fake "verify you are human" steps that make you paste a command, crypto wallet drainers,
   fake middlemen, fake staff, and payment pressure, and also the scams that need no link, such as investment and
   "wrong number" scams, fake bank fraud alerts and "safe account" transfers, government threats, tech support pop-ups
   and remote access requests, toll and delivery fees, task and easy-money jobs, changed bank details from a "boss"
   or supplier, sextortion, overpayment and payment app tricks on marketplaces, fake account appeals, and fund
   recovery scams. A message that names Steam or Discord but links somewhere else is flagged too.
5. **Check emails on the device.** A saved .eml is read in the browser: its sender, subject, and text, and the sender
   checks (SPF, DKIM, and DMARC) that the receiving mail server recorded. ScamCam warns when nothing confirms who
   really sent the email, when the sender's name says Steam, Discord, or Microsoft but the address belongs to someone else, when
   the sender's domain is a look-alike or on a scam list, when replies go to a different domain, and about risky
   attachments.
6. **Check files on the device.** A file's real type comes from its contents, not its name, and the browser looks
   for disguised endings, Office macros, PDF actions, fake login pages, programs inside archives, browser extensions
   that can read your login cookies, programs packed from Python scripts (a common way to build Discord token
   grabbers), shortcuts and registry files that change startup settings, and Roblox models with backdoor scripts. Its
   SHA-256 and SHA-1 fingerprints are looked up in MalwareBazaar, CIRCL hashlookup, and Team Cymru's Malware Hash
   Registry, and the report links to VirusTotal, Hybrid Analysis, and Cisco Talos for the visitor to open themselves,
   because VirusTotal's terms do not allow showing its results to others.
7. **Check Minecraft mods and modpacks.** The browser reads the code inside a mod, including text hidden in encoded
   form, for what account stealers do: looking in the folders where Discord, browsers, and wallets keep logins,
   sending data to a Discord webhook, downloading and running more code, hiding from security tools, and taking the
   Minecraft login token. The mod's fingerprint and ID are then compared with Modrinth. A file that claims to be a
   popular mod but is not one of its releases is flagged, and Modrinth's listing only counts in a file's favor once a
   release has been public for two weeks, because hacked developer accounts spread malware as new releases. Modpacks
   are checked for downloads from unsafe places and for the mods they carry.
8. **AI only as a last resort.** If the rules and sources cannot decide, a small open model (Qwen3 on Workers AI)
   labels the message. Its answer counts as one warning sign, never as proof. The message is passed as untrusted
   data, and messages that try to talk to checkers or AI models are flagged instead of being sent to it.
9. **Weigh the evidence.** Independent sources count more than a single rule, contradictions lower the confidence,
   and confirmed listings outrank everything else.

## How well it works

These are measured results, not promises, and the full tables are in [docs/STATUS.md](docs/STATUS.md#benchmarks)
and [docs/SCAMCAM_ANALYSIS.md](docs/SCAMCAM_ANALYSIS.md).

| Test | Result |
|---|---|
| Real phishing domains held out from tuning, rules alone with every outside source switched off | 94 of 200 gaming-impersonation domains flagged, and none of 178 legitimate sites. General phishing with no game name is left to the scam lists and Safe Browsing, so the rules alone flagged 0 of 200 random ones |
| Scam and normal messages held out from tuning | Rules alone caught 3 of 20 scams; rules with the AI step caught 16 of 20, with no false alarms on 20 normal messages |
| 61 real files from Modrinth, including the 40 most downloaded mods | None flagged |

## Privacy and security

- **Files never leave the device.** The browser reads a file without opening or running it, and only its
  fingerprints, size, type, and fixed finding codes are sent, never the file or its name. For a Minecraft mod, the
  mod ID written inside it (such as `sodium`) is sent too, so it can be compared with Modrinth.
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
- **Tested in a real browser.** Every change is checked in Chrome to confirm that no message, file name, file
  contents, email address, or attachment reaches any server it should not.
- **Reviewed.** I mapped the API against the OWASP API Security Top 10 and ASVS, and the AI step against the OWASP
  Top 10 for LLM Applications 2026. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Running cost: $0

ScamCam runs entirely on Cloudflare's free plan and GitHub's free tier. The free plan gives a Worker only 10 ms of
CPU per request, so the Worker stays a thin front door (bot check, rate limits, signing) and the scan engine runs in a
Durable Object, which the free plan gives up to 30 seconds per request. If the scanner is ever unreachable, the
Worker runs the scan itself. A request may also make only 50 outside calls, and a scan with 20 links uses at most 38.
Every source has a hard daily budget, and when one runs out the report says which check was skipped instead of
guessing. The limits and how ScamCam stays inside them are in [docs/COST_MODEL.md](docs/COST_MODEL.md).

## Built with

React 19, TypeScript, Vite, and Tailwind CSS for the site. One Cloudflare Worker serves the static site and a Hono
API validated with Zod and documented with OpenAPI at `/api/v1/openapi.json`. Cloudflare D1 holds only short-lived
operational data and the hashed scam lists. Every change runs type checks, the test suite (in Cloudflare's real
runtime), an accessibility audit, a privacy and header check, and a secret scan in GitHub Actions.

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
