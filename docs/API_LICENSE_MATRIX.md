# Threat intelligence license matrix

Checked against official documentation on 2026-10-05. "Unverified" means a primary source could not be confirmed.
Re-check terms before enabling each integration and at least yearly.

| Source | Use in ScamCam | Auth | Limits | Attribution | Caching | Privacy | Decision |
|---|---|---|---|---|---|---|---|
| Tesseract.js 7.0.0 and tesseract.js-core 7.0.0 | Reading text from screenshots in the visitor's browser | None | Runs on the device | Apache 2.0 license text served at `/ocr/7.0.0-2/licenses/` | Served by ScamCam with a one-year immutable cache | The image never leaves the device | **Stage 7** |
| English model (`@tesseract.js-data/eng` 1.0.0, `4.0.0_best_int`) | Language data for Tesseract | None | 2.95 MB, downloaded once | MIT package of Tesseract's Apache 2.0 `tessdata` | Same as above | Local only | **Stage 7** |
| jsQR 1.4.0 | Reading QR codes in screenshots | None | Runs on the device | Apache 2.0 license text served at `/ocr/7.0.0-2/licenses/` | Bundled | Local only | **Stage 7** |
| Public Suffix List via `tldts` | Registrable domain, lookalike checks | None | Local | MPL-2.0 notice (list), MIT (`tldts`) | Bundled, refreshed with releases | Local only | **MVP** |
| Google Safe Browsing v5 `hashes:search` | Known phishing, malware, unwanted software | Free Google Cloud API key | Per Cloud Console quota (no published number) | Warnings must say "Advisory provided by Google" and link to Google's advisory page | Must honor `cacheDuration`; never show a warning after the cache expires | Only 4-byte hash prefixes leave ScamCam | **MVP** (noncommercial terms fit) |
| Cloudflare DNS over HTTPS (JSON) | NS, MX, A records, resolution failures | None | Not published | None | Respect TTL | Domain only; Cloudflare deletes logs within 25 hours | **MVP** |
| RDAP via IANA bootstrap | Domain age, registrar, status | None | Per registry; expect HTTP 429 | None | Cache results; back off on 429 | Domain only | **MVP**, cached, single user-requested lookups only (Verisign forbids high-volume automated use) |
| abuse.ch URLhaus | Known malware URLs | Free Auth-Key (mandatory) | Fair use; bulk downloads no more often than every 5 minutes | Do not remove notices | Download and match locally | Nothing per scan if matched locally | **MVP**. Terms (2025-11-04) allow not-for-profit use but forbid republishing or derivative datasets without consent, so show individual matches only |
| Phishing.Database (GitHub) | Supplementary phishing domains | None | Raw GitHub downloads | MIT | Local copy | Local only | **MVP**, labeled lower confidence (known false positives) |
| Pwned Passwords | Only if accounts are ever added | None | No rate limit | None required | n/a | k-anonymity; hash in the browser | Deferred |
| OpenPhish community feed | | None | 12-hour updates | Copyright notice | | Local | **Not used**: terms forbid making the data available to third parties without written consent |
| PhishTank | | App key | | | | | **Not used**: new registrations disabled |
| VirusTotal public API | | Free key | 4/min, 500/day | | | Submitted URLs are shared with VT's community | **Not used**: restrictions on products and services, quota cannot serve the public, privacy |
| Spamhaus DBL, SURBL | | DQS key / none | Fair use | Unverified | Unverified | Domain to provider | **Deferred**: they block public resolvers, so they need raw DNS from the Worker |
| crt.sh | Certificate history | None | About 5 requests per minute per IP, frequent errors | None stated | Cache heavily | Domain to Sectigo | **Deferred** to optional signal |
| Phishing Army | | None | 6-hour updates | CC BY-NC 4.0 | | Local | **Not used**: may inherit OpenPhish and PhishTank terms |
| discord-phishing-links | | None | | MIT | | Local | **Not used**: maintenance mode, data going stale |
| Quad9 | | None | Unverified | | | Domain to Quad9 | **Deferred**: terms page unreachable on check date |
| Google Web Risk | | Billing | Paid | | | Full URL | **Not used**: commercial product |
| NVD, CISA KEV, OSV.dev, FIRST EPSS, GitHub Security Advisories | Vulnerability context for gaming mods (later) | Optional key (NVD) | NVD about 5 per 30 seconds without a key | NVD notice; GHSA CC-BY 4.0 | | Package names only | **Deferred** to a later phase |

## How sources plug in

Each source is its own module in `src/engine` with a lookup function, a timeout, and a typed result that always
includes "unavailable". The scan orchestrator turns results into evidence, so a source can be added, replaced, or
removed without changing the report code. Results are evidence, never the final verdict on their own. A shared
adapter interface with per-source cache policies arrives with caching in Stage 4.

## Implementation status (Stage 4)

| Source | Status | Notes |
|---|---|---|
| Public Suffix List (`tldts` 7.4.16) | Working | Bundled; refreshed when the package is updated |
| Google Safe Browsing v5 | Working locally with a live key (2026-10-05) | Google's phishing, malware, and unwanted software test pages are flagged live, and Google's full hashes equal ScamCam's own hashes of them. `hashes:search` answers only in binary Protocol Buffers (`application/x-protobuf`); a JSON request is refused with "Unsupported Output Format". `src/engine/protobuf.ts` decodes the answer. Capped by `SAFE_BROWSING_DAILY_LIMIT`. Reports show "Advisory provided by Google" and hedged wording |
| URLhaus host lookup | Working locally with a live key (2026-10-05) | Sends only the hostname. Live lookups of clean hosts return "no results"; a live match has not been seen yet. Capped by `URLHAUS_DAILY_LIMIT`. Matches on shared hosts (free hosting, chat file hosts) are shown as context, never as confirmation |
| RDAP | Working | IANA bootstrap cached for 12 hours per Worker instance; one lookup per registrable domain; 404 means not registered; 429 and errors show as "did not respond" |
| Cloudflare DNS over HTTPS | Working | One A-record lookup per hostname |
| Phishing.Database | Built, switched on at deployment | The "new today" and "last hour" feeds have not changed since December 2025, so the daily sync uses `phishing-domains-ACTIVE.txt` (about 11 MB, updated several times a day) at a pinned commit. Stored as hashed shards; matches are labeled as a community list that can be wrong; MIT license credited in reports. Checked at full size on 2026-10-05: 392,063 entries, including IPv4 addresses and host names with underscores |
| Everything marked Not used or Deferred above | Unchanged | |

## AI model

| Model | Use | Terms | Data |
|---|---|---|---|
| `@cf/qwen/qwen3-30b-a3b-fp8` on Workers AI | One-label classification of unclear messages | Qwen3 is released under Apache 2.0; Workers AI is covered by Cloudflare's terms and its free daily allocation | Cloudflare says it does not use Workers AI content to train models and does not store it unless the app adds a storage service, which ScamCam does not |
