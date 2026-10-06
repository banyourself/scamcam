# Security review

Date: 2026-10-05, before launch, with sections added on 2026-10-06 for screenshot reading and share links. Scope:
the code on `main` at the end of the security hardening work, run on my PC and in GitHub Actions. Nothing was
deployed yet, so live Cloudflare behavior is not covered here; the live checks after launch are in `STATUS.md`. This
is a self-review backed by automated tests, not an independent penetration test. AI risks are covered separately in
`OWASP_LLM_TOP_10.md`.

## Method

- Read every Worker entry point, middleware, provider client, and the report page against the OWASP API Security
  Top 10 (2023) and the relevant chapters of OWASP ASVS 5.0.
- Wrote a test for each finding and, where practical, checked that it fails on the old code. The slow-input tests
  failed on 8 crafted inputs before the fix, and the log and cache privacy tests failed when a leak was planted on
  purpose.
- Ran `npm test`, `npm run test:a11y`, `npm run test:privacy`, `npm run test:recovery`, `npm audit`,
  `npm audit signatures`, and Gitleaks (CI).

## Findings fixed

| # | Finding | Severity | Fix | Test |
|---|---|---|---|---|
| 1 | Too many subrequests for the Workers Free plan. Cloudflare counts outside fetches, D1 queries, and Cache API calls against one limit of 50 per request. Safe Browsing kept one Cache API entry per hash prefix, so a message with 20 links needed about 750 of them, and even one link could need 26. Past the limit, lookups and the D1 budget counters would fail, and reports would wrongly say sources did not respond or were over budget | Medium | Safe Browsing answers are kept per prefix in the Worker's memory, other lookups check memory before the shared cache, registry back-off is kept in memory, and each request may make at most 24 shared cache calls. A 20-link message now uses 43 subrequests (12 fetches, 22 cache calls, 9 queries), and a repeated scan in the same Worker instance makes none | `test/worker/security.test.ts` counts every fetch, cache call, and query for a 20-link scan; `test/client/performance.test.ts` checks every benchmark case and the 20-link cases |
| 2 | The daily cleanup could run up to 107 D1 queries when tables had a backlog, and D1 allows 50 per invocation on the Free plan | Low | One budget of 25 delete batches is shared by all tables, keeping a run under 35 queries | `test/worker/maintenance.test.ts` |
| 3 | Slow regular expressions. On crafted 4,000-character inputs (dots, accent marks, emoji, slashes), link and email extraction did work that grew with the square of the length, up to about 23 ms per scan in Node. The Workers Free plan allows 10 ms of CPU per request | Medium | Cheap checks run first, host names stop at 30 labels, the "email inside a link" check runs in code once per match, and the hidden-link check only starts at word boundaries | `test/client/worst-case.test.ts`: 31 crafted inputs must take time that grows in step with their length, plus 300 fuzzed inputs. The slowest scan now takes under 1 ms |
| 4 | Each IPv6 address had its own rate limit, and one home network usually has a whole /64 (about 18 quintillion addresses) | Medium | IPv6 visitors are limited per /64; IPv4-mapped addresses count as their IPv4 address | `test/worker/security.test.ts` |
| 5 | Answers from Safe Browsing, URLhaus, RDAP, DNS, and Turnstile were read without a size limit | Low | Reads stream and stop at 64 KB to 1 MB depending on the source | `test/engine/limited-body.test.ts` |
| 6 | The scan endpoint ignored unexpected fields instead of refusing them | Low | Unknown fields return 400 | `test/worker/security.test.ts` |
| 7 | A client could choose its own request ID, which then appeared in logs and error replies | Low | The Worker always makes its own random ID | `test/worker/security.test.ts` |
| 8 | The report linked to whatever "reference" address URLhaus sent. React 19 and the CSP already block `javascript:` links, but a bad answer could point the link at any site | Low | Only `https://urlhaus.abuse.ch` pages are kept, and the report schema accepts only `https` links | `test/engine/scan.test.ts` |
| 9 | Cloudflare's automatic per-request logs ("invocation logs") hold "the Request, Response, and related metadata" according to Cloudflare's docs, which may include the visitor's IP address. The Privacy page says logs have none | Low (privacy) | Invocation logs are off in `wrangler.jsonc`. ScamCam's own logs keep the route, status, and timing | `test/node/config.test.ts` |
| 10 | The Privacy page said lookup answers are kept for "15 minutes to a day", but DNS answers can be kept for as little as a minute | Info | Wording fixed | |
| 11 | `security.txt` pointed its `Policy` field at the Security page instead of the disclosure policy, and `/security.txt` showed the app instead of the file | Info | `Policy` points to `/disclosure`, and `/security.txt` redirects to `/.well-known/security.txt` | `test/node/config.test.ts`, `scripts/privacy-check.ts` |

## Checked, no change needed

| Area | Evidence |
|---|---|
| SSRF | Submitted links are never fetched. A test submits cloud metadata, loopback, and private addresses and checks that none is contacted; outside requests go only to fixed provider hosts |
| Injection | Queries that use request data bind their parameters; the only SQL written as text is the list sync file, built offline from validated values. A test sends SQL in a message. React escapes report text, and provider answers are checked against schemas |
| XSS and clickjacking | Strict CSP without inline scripts, `frame-ancestors 'none'`, and `X-Frame-Options: DENY`, checked on every page, asset, and API answer by `scripts/privacy-check.ts` |
| CSRF and CORS | Cross-site posts are refused and no CORS headers are sent. The only CORS header seen came from Vite's local preview server, which production does not use; the check turns it off |
| Secrets | None in the repository (Gitleaks). `scripts/privacy-check.ts` scans all 34 built files against the local secret values and common key formats and finds none. The plugin's `.dev.vars` copy in `dist/` is excluded from upload by `.assetsignore` and never committed |
| Privacy in the browser | A real browser visit of every page, a theme change, and a scan contacts only ScamCam and `challenges.cloudflare.com`, sets no cookies, and stores only `scamcam-theme`; the scan request carries only `content` and `turnstileToken` |
| Privacy in the Worker | Tests show that logs, cache keys, cache values, D1, and outside requests carry no submitted text, and that outside sources get only a host name or hash prefixes |
| Errors | Generic messages with a request ID; only the error type and route are stored, for 7 days |
| Dependencies | `npm audit`: 0 vulnerabilities. Registry signatures verified, an SBOM from every CI run, every GitHub Action pinned to a commit |
| Concurrency | 16 scans sent at once from one address: exactly 10 get through (local simulator) |
| Cleanup | 10,250 expired rows in one table are removed in two daily runs, with a backlog alert after the first. With a backlog in every table, one run deletes 11,000 rows in 25 batches and stays under 50 queries |
| Partial list sync | A sync that stops partway leaves a mix of old and new shards that still answers correctly |
| Recovery | Export and restore of a throwaway database matches on every table (`RECOVERY.md`) |
| Disclosure contact | `kevinle.tech` has MX records, SPF, a DKIM key (selector `titan1`), and a DMARC reject policy (DNS lookups on 2026-10-05), so the security contact address can receive reports and its replies should pass DMARC. On 2026-10-05 a test report from an outside Gmail address arrived, and the reply from the security contact address reached the Gmail inbox |

## OWASP API Security Top 10 (2023)

| Risk | Status |
|---|---|
| API1 Broken object level authorization | Not applicable: no accounts, stored objects, or IDs in requests |
| API2 Broken authentication | Not applicable: no accounts. Turnstile is verified on the server and fails closed |
| API3 Broken object property level authorization | Unknown request fields are refused; every report is checked against its schema before it is sent |
| API4 Unrestricted resource consumption | 16 KB bodies, 4,000 characters, 20 links, 10 scans and 60 API requests a minute per visitor at each Cloudflare location, Turnstile on every scan, daily budgets for Safe Browsing, URLhaus, and Workers AI, response size caps, timeouts, parsing that grows in step with input length, and at most 43 subrequests per scan |
| API5 Broken function level authorization | No admin endpoints. Scheduled tasks cannot be called over HTTP |
| API6 Unrestricted access to sensitive business flows | Scanning is the only flow; it is protected by Turnstile, rate limits, and budgets, and bulk use is banned by the acceptable use policy |
| API7 Server side request forgery | Submitted links are never fetched; only fixed provider hosts are called |
| API8 Security misconfiguration | Security headers, CSP, no CORS, generic errors, no workers.dev or preview URLs, invocation logs off; all checked by tests |
| API9 Improper inventory management | One versioned API under `/api/v1`, described by `/api/v1/openapi.json`; no other environments are deployed |
| API10 Unsafe consumption of APIs | Every provider answer is size-capped, time-limited, and checked against a schema; nothing from a provider is shown as HTML, and provider links must be the provider's own `https` pages |

## OWASP ASVS 5.0 (chapters that apply)

| Chapter | Status |
|---|---|
| Encoding and sanitization | React escaping; no HTML from visitors or providers; hidden characters removed before display |
| Validation and business logic | Zod schemas on requests, provider answers, and reports; the limits listed under API4 |
| Web frontend security | CSP, frame protection, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, HSTS; no cookies |
| API and web service | JSON only, generic errors, `Cache-Control: no-store`, versioned paths |
| Authentication, session management, authorization, self-contained tokens, OAuth | Not applicable: no accounts |
| Cryptography | SHA-256 for cache and list keys through Web Crypto; no custom cryptography |
| Secure communication | HTTPS through Cloudflare with HSTS; every provider call uses HTTPS |
| Configuration | Exact dependency versions, pinned actions, SBOM, audits, and a test that blocks public deploy targets |
| Data protection | Nothing personal is stored; retention enforced by the daily cleanup |
| Security logging and error handling | Structured logs without personal data, server-made request IDs, alerts for capacity and failures |
| File handling, WebRTC | Not applicable |

## What the rate limits can and cannot do

Cloudflare's documentation says the rate limiting binding keeps "a unique limit per Cloudflare location" and is
"permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system". Someone
who spreads requests over many Cloudflare locations can therefore send more than 10 scans a minute in total.

Protection for the whole service comes from two other layers. Every scan needs a fresh Turnstile token, which is
checked on the server, and Cloudflare accepts each token only once. The daily budgets in D1 are counted exactly for
the whole service: 8,000 Safe Browsing calls, 5,000 URLhaus calls, and 2,000 Workers AI calls. Past a budget, that
source is reported as not checked instead of going over its free quota.

## Still open

- Live checks after deployment: `npm run check:live` passed on 2026-10-05 for headers, cookies, `security.txt`, the
  API, the browser, and the personal site (`STATUS.md`). A real scan through the live Turnstile widget is still
  checked by hand, because Turnstile does not finish in a headless browser.
- A manual screen reader review.
- CPU time on the Free plan: live scans measured 11 to 29 ms against a 10 ms limit before the startup warm-up; the warm-up's effect is not yet measured (`STATUS.md`).
- No lawyer has reviewed the policy pages; the open questions were researched instead (`COMPLIANCE_MATRIX.md`).
- An independent penetration test, if ScamCam grows.

## Screenshot reading (2026-10-06)

Visitors can add a screenshot by pasting it, dropping it, or picking a file. The browser reads its text with
Tesseract.js and any QR code with jsQR, shows the text for review, and the visitor then scans it like a typed message.

### Design decisions that remove attack surface

- **No upload and no new API.** Images never leave the visitor's device. The Worker still accepts only the same
  text request, with the same 16 KB body limit, 4,000-character input limit, strict fields, rate limits, and
  Turnstile check. There is no image endpoint to abuse, and no server code ever parses an image.
- **The browser's own decoder.** Images are decoded only by the browser (`createImageBitmap`), which is sandboxed
  and hardened. The OCR engine and the QR reader never see the original file, only pixels drawn on a canvas.
- **Text only.** Read text goes into the text box as plain text, never as HTML, and then through the normal
  pipeline: hidden-character removal, email, phone, and code redaction, the checker guard, and the usual rules.

### Threats checked

| Threat | Protection | Test |
|---|---|---|
| A file that pretends to be an image (HTML, a program, a ZIP, a PDF) | The first bytes must be a real PNG, JPEG, WebP, or GIF signature; the file name and claimed type are ignored | `test/client/image-check.test.ts`; the browser check pastes HTML labeled `image/png` and sees it refused |
| An SVG with a script | SVG is not accepted at all | Unit test and browser check |
| A decompression bomb (a small file that decodes to a huge image) | Width and height are read from the file header before decoding: at most 16,384 pixels a side and 40 megapixels, and the decoded size is checked again | Unit tests for PNG, GIF, WebP, and JPEG headers that claim huge sizes |
| Malformed or truncated headers | The header reader stops at the end of the data and refuses anything it cannot read; 500 random inputs never make it throw | Unit tests |
| A file too large to handle | 10 MB limit before anything is read | Unit test |
| A slow or stuck read | OCR runs in a separate worker with 90-second limits for starting and reading, and the worker is shut down after every image | Code review |
| A compromised or swapped OCR file | Tesseract.js, its WebAssembly core, the English model, and jsQR are pinned to exact versions, installed with lockfile integrity hashes and registry signatures, and served from ScamCam itself under a versioned path; a config test checks that the served version matches the installed one | `test/node/config.test.ts`, `npm audit signatures` |
| Loosening the content security policy | Only `'wasm-unsafe-eval'` was added, which allows compiling WebAssembly but not running JavaScript from strings, plus `worker-src 'self'`. `'unsafe-inline'` and `'unsafe-eval'` stay banned | Config test; the browser check records no policy violations |
| Leaking the image or its hidden details | No upload, no storage: the model is not cached in IndexedDB (`cacheMethod: "none"`), and photo metadata such as location never leaves the device | The browser check watches the page and the OCR worker: only GET requests to ScamCam's own files, nothing stored |
| Instructions hidden in a screenshot to steer the AI check | Read text is treated exactly like typed text, so the checker guard and the AI rules apply | Existing injection tests |

### Licenses

Tesseract.js, tesseract.js-core, and jsQR are Apache 2.0, and their license texts are served with the files under
`/ocr/7.0.0-2/licenses/`. The English model comes from the `@tesseract.js-data/eng` package (MIT), built from
Tesseract's Apache 2.0 `tessdata`.

## Share links (2026-10-06)

A visitor can press Share on a report to get a link that works for 5, 10, or 15 minutes (10 by default). The
message text is left out unless they tick the box.

### Design

- **Opt-in.** Nothing is stored unless someone presses Share.
- **Encrypted, with a key ScamCam does not keep.** The server encrypts the shared report with AES-GCM under a new
  random 128-bit key, stores only the ciphertext, and returns the key once. The link carries the key after `#`, a
  part of the address that browsers never send to servers, so neither ScamCam's database nor its backups can be
  read without the link.
- **Only real reports.** Each scan answer carries an HMAC-SHA256 signature of the exact report, made with a secret
  only the Worker holds (`SHARE_SIGNING_KEY`). Sharing requires a valid signature over an unchanged report made in the
  last 30 minutes, so nobody can publish a made-up "this site is safe" report under ScamCam's name.
- **Real expiry.** Reads refuse expired rows, and a cleanup every 5 minutes deletes them.

### Threats checked

| Threat | Protection | Test |
|---|---|---|
| A fake or edited report shared under ScamCam's name | HMAC signature over the exact report; edited, forged, missing, and old signatures are refused | `test/worker/shares.test.ts` |
| Guessing share links | 128-bit random ids; the same 404 for expired, unknown, and malformed ids; the API rate limit | Unit test of identical 404 answers |
| Reading stored reports | Only ciphertext is stored; the key is never stored or logged | The test dumps the table and finds neither the message nor the key |
| Using sharing as free storage | Only signed reports, at most 16 KB, 10 links a minute per visitor, at most 2,000 active links, and no new links while storage writes are paused | Rate limit test |
| Leaking the key | The key stays in the address fragment; the browser check confirms it never appears in any request | `scripts/privacy-check.ts` |
| Search engines indexing shared reports | `noindex` in the page and the `X-Robots-Tag` header on `/r/*`, and `robots.txt` disallows `/r/` | Header check |
| Revealing the message by accident | The message is excluded unless the sharer ticks the box, which warns that names and usernames would be visible | Unit and browser tests |
| Exceeding the Free plan's cron and query limits | One extra cron (3 of the account's 5); each cleanup run makes at most 10 queries | Config test |
