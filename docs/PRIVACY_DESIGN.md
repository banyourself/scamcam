# Privacy design

ScamCam processes content that can be private (messages from friends, links with tokens in them) and is used by
teenagers. The design goal is to keep nothing that is not needed.

## What is processed

| Data | Why | Stored? |
|---|---|---|
| Submitted message text | To find links and scam patterns | No. Processed in memory and discarded |
| A file the visitor checks | To find its real type and warning signs, and to look up its fingerprints | Never uploaded. The browser sends only SHA-256 and SHA-1 fingerprints, size, type, extension, and fixed finding codes. Nothing is stored; lookup answers are cached in memory for up to a day under hashed keys |
| Submitted URL | To check its domain and reputation | Not raw. Only a keyed hash or the registrable domain when an indicator must be cached |
| IP address | Rate limiting, Turnstile | Not by ScamCam. Passed to the Cloudflare rate limiter and Turnstile, which do not store it for us |
| Request metadata | Debugging | Worker logs keep method, route, status, duration, and a request ID made by the Worker for 3 days. No IP, no URL, no query. Cloudflare's own per-request invocation logs are turned off |
| Error type and route | Reliability | `error_events` for 7 days |

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
| Cloudflare Turnstile | The Turnstile token and the visitor's IP address | Every scan |
| Workers AI | The message with emails, phone numbers, long codes, and invisible characters removed and links replaced by `[link]`; names and usernames stay | Only when the rules cannot decide and the message does not try to instruct checkers; Cloudflare says it does not store this content or use it to train models |
| Phishing.Database (GitHub) | Nothing from users. A daily GitHub Actions job downloads the public list | After deployment |

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
