# Threat intelligence license matrix

Checked against official documentation on 2026-10-05. "Unverified" means a primary source could not be confirmed.
Re-check terms before enabling each integration and at least yearly.

| Source | Use in ScamCam | Auth | Limits | Attribution | Caching | Privacy | Decision |
|---|---|---|---|---|---|---|---|
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

## Adapter contract (Stage 3)

Every source is an adapter with the same shape: a name, the evidence types it can provide, a timeout, a daily
budget, a cache policy, and a `lookup` function that returns typed evidence or a typed "unavailable" result. The
engine can drop, replace, or add a source without changing the report code. Results are evidence, never the final
verdict on their own.
