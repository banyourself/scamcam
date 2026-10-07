# Privacy design

ScamCam processes content that can be private (messages from friends, links with tokens in them) and is used by
teenagers. The design goal is to keep nothing that is not needed.

## What is processed

| Data | Why | Stored? |
|---|---|---|
| Submitted message text | To find links and scam patterns | No. Processed in memory and discarded |
| Wallet addresses in a message | To compare them with ScamSniffer's list of scam wallets | No. Compared with a hashed copy of the list in D1, like phone numbers; never sent to an outside service |
| An email file the visitor adds | To read the message and the receiving server's sender checks | Never uploaded. The browser sends the text a visitor could paste (sender name, subject, body), the sender's domain, the SPF, DKIM, and DMARC results, a flag for replies to another domain, and each attachment's type, ending, and finding codes. Addresses, recipients, attachment names, and attachments stay on the device |
| US phone numbers in a message | To compare them with the FTC's and FCC's lists of numbers reported for unwanted calls | No. Hidden from the text and from every outside service; normalized (`+1` and 10 digits) and compared with a hashed copy of the list in D1, so only a shard number (10 bits of a hash) reaches the database |
| A file the visitor checks | To find its real type and warning signs, and to look up its fingerprints | Never uploaded. The browser sends only SHA-256 and SHA-1 fingerprints, size, type, extension, and fixed finding codes. Nothing is stored; lookup answers are cached in memory for up to a day under hashed keys |
| Submitted URL | To check its domain and reputation | Not raw. Only a keyed hash or the registrable domain when an indicator must be cached |
| IP address | Rate limiting, Turnstile | Not by ScamCam. Passed to the Cloudflare rate limiter and Turnstile, which do not store it for us |
| Request metadata | Debugging | Worker logs keep method, route, status, duration, and a request ID made by the Worker for 3 days. No IP, no URL, no query. Cloudflare's own per-request invocation logs are turned off |
| Error type and route | Reliability | `error_events` for 7 days |
| A flag the visitor sends on a result | So I can review the result by hand | `result_flags` for 30 days, or until I mark it reviewed: the case number, verdict, finding IDs, the link's registrable domain (or its host when it has none) or the file's SHA-256, the reason, and the note after redaction. Never the message, the full link, the file, the signature, or the IP address. Flags are never read by the scan engine |

## What is never collected

Accounts, names, emails (unless someone emails a report), analytics, advertising IDs, fingerprints, browsing
history, screenshots, cookies other than strictly necessary security cookies from Cloudflare.

## Third parties

| Party | Receives | When |
|---|---|---|
| Cloudflare | All traffic (host and edge), Turnstile signals | Always |
| Google Safe Browsing | 4-byte SHA-256 prefixes of URL expressions, never the URL | Every scan with links, when a key is set |
| abuse.ch URLhaus | The hostname only (for example `login.example.com`) | Up to 3 hosts per scan, when a key is set |
| Domain registries (RDAP) | The registrable domain only (for example `example.com`) | Up to 3 per scan |
| Cloudflare DNS over HTTPS | The hostname only | Up to 3 per scan |
| ThreatFox (abuse.ch) | The registrable domain only | Up to 3 per scan, only in the scanner |
| MalwareBazaar (abuse.ch) | A file's SHA-256 only | Each file check with a fingerprint, when a key is set |
| CIRCL hashlookup | A file's SHA-256 only | Each file check with a fingerprint |
| Team Cymru Malware Hash Registry, through Cloudflare DNS | A file's SHA-1 only | Each file check with a fingerprint |
| Cloudflare 1.1.1.2 security DNS | The hostname only | Up to 3 per scan |
| Spamhaus DQS (DBL and ZRD), through Cloudflare's DNS over HTTPS resolver | The registrable domain inside a DNS name that also holds ScamCam's access key, sent in a request body to Cloudflare's resolver, which asks Spamhaus | Up to 3 domains per scan (6 lookups), only in the scanner, when the key is set; never logged by ScamCam. Cloudflare says it deletes resolver logs within 25 hours |
| PhishStats | The registrable domain, or the exact host for tenants of shared hosting | The main link only, only in the scanner, when the key is set; at most 140 a day |
| Cloudflare Radar | The registrable domain only | Up to 2 per scan, only in the scanner, when the token is set; never for shared hosting |
| Bitly, is.gd, and v.gd | Only the short code of their own short links (for example `bit.ly/abc`), with ScamCam's Bitly token for Bitly | Up to 2 per scan, only in the scanner; the destination is checked like any other link and never opened |
| Discord | The invite code from a Discord invite link | Up to 2 per scan, only in the scanner; answers kept in memory for an hour |
| Steam (Valve) | The profile name or account number from a steamcommunity.com link, with ScamCam's API key | Up to 2 accounts per scan (at most 4 calls), only in the scanner, when the key is set; answers kept in memory for an hour |
| VirusTotal, Google Safe Browsing site status, urlscan.io, Cisco Talos, ScamAdviser, URLVoid, Hybrid Analysis | Nothing from ScamCam. The report links to their public pages; they see the domain or fingerprint in the address only if the visitor clicks | Only when the visitor clicks |
| Cloudflare Turnstile | The Turnstile token and the visitor's IP address | Every scan |
| Workers AI | The message with emails, phone numbers, long codes, and invisible characters removed and links replaced by `[link]`; names and usernames stay | Only when the rules cannot decide and the message does not try to instruct checkers; Cloudflare says it does not store this content or use it to train models |
| Phishing.Database, MetaMask, ScamSniffer (sites and wallets), PhishDestroy, DevSpen (GitHub), CERT Polska, the FTC's Do Not Call reports, and the FCC's consumer complaints | Nothing from users. A daily GitHub Actions job downloads the public lists | Daily |

## Children

Gaming audiences include minors. Rules that apply from day one:

- No accounts, chat, profiles, public posts, or user-generated content.
- A warning beside the input not to paste passwords, login codes, or personal details.
- Server-side redaction of emails, phone numbers, and long digit runs before the AI step, which also never sees links.
- IP use limited to security (COPPA's internal-operations purpose).
- A plain-language privacy summary on the Privacy page.

## Caching rules

- Never put private messages or secret-bearing URLs into shared caches.
- Cache only public indicators (registrable domain reputation, provider results) under each provider's terms.
- Normalize conservatively so distinct indicators are not merged (`SCAMCAM_ANALYSIS.md`).
- Provider answers live in the Worker's memory and in a named Cloudflare cache under SHA-256 keys, so neither holds
  the names that were looked up. Values hold only the provider's answer. Safe Browsing answers are kept per hash
  prefix in memory only.
- AI answers (one label) are kept only in the Worker's memory, for an hour, under a hash of the cleaned message.
- The `Scanner` Durable Object keeps the same kinds of answers in its memory only, under the same hashed keys and
  expiry rules. It writes nothing to its storage.
