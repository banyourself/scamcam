# Changelog

What shipped in ScamCam and how it was verified, newest first. Dates come from the commit history. The current
state, test totals, and open items are in [docs/STATUS.md](docs/STATUS.md).

## 2026-10-06: Share links

- A Share section under each report makes a link that works for 5, 10, or 15 minutes (10 by default). The message
  text is included only if the sharer ticks the box, which warns that names and usernames would be visible.
- The server encrypts the shared report with AES-GCM under a new random 128-bit key that is returned once and never
  stored. The link carries the key after `#`, so the `shared_reports` table (migration `0005`) holds only ciphertext
  and backups are unreadable without the link.
- Scan answers carry an HMAC-SHA256 signature of the exact report (`X-Report-Signature`). Only an unchanged report
  signed in the last 30 minutes can be shared, so edited or made-up reports are refused.
- Expired links answer "This link has expired", a cleanup every 5 minutes deletes them, and shared pages under `/r/`
  are not indexed.
- Limits: 10 share links a minute per visitor, at most 2,000 active links, 16 KB bodies, and no new links while
  storage writes are paused.
- Verified: 9 new Worker tests (round trip, ciphertext-only storage, edited, forged, and old reports, lifetimes,
  identical 404s, cleanup, rate limit, a missing key, and logs) and a browser step that scans, shares, opens the
  link, and checks that the key never reaches a server. 449 Vitest tests in 27 files, 13 Node tests, the browser
  check, and the accessibility audit pass.
- Security review: [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md#share-links-2026-10-06).

## 2026-10-06: Screenshot reading

- Visitors can paste, drop, or pick a screenshot. The browser reads its text with Tesseract.js 7.0.0 (English
  `best_int` model) and any QR code with jsQR 1.4.0, inverts dark-mode screenshots first, and puts the text in the
  box to review before checking.
- Nothing is uploaded or stored. The OCR worker, the WebAssembly builds, the model, and the license texts are served
  by ScamCam itself under `/ocr/7.0.0-2/` with a one-year immutable cache, and the model is not cached in browser
  storage. A first screenshot downloads about 7 MB once.
- Only real PNG, JPEG, WebP, and GIF files are accepted, judged by their first bytes. SVG is refused. Sizes are read
  from the header before decoding (at most 10 MB, 16,384 pixels a side, and 40 megapixels), and OCR runs in a worker
  with time limits.
- The content security policy gained only `'wasm-unsafe-eval'` and `worker-src 'self'`.
- Fixed the same day: scripts and OCR files under `/assets/` and `/ocr/` no longer send `no-transform`, so
  Cloudflare compresses them again (the main script had gone out at 307 KB instead of about 94 KB). The OCR files
  moved to a fresh path so no uncompressed cached copies are served. Pages keep `no-transform`.
- Verified: 27 unit tests for crafted and random image headers, and a browser step that reads light and dark
  screenshots, refuses an SVG and a fake PNG, and watches the page and the OCR worker for any upload, outside
  request, or storage. Any request body over 50 KB, the size a leaked screenshot would need, fails the check. 440
  Vitest tests in 26 files, 13 Node tests, and 52 accessibility checks pass.
- Security review: [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md#screenshot-reading-2026-10-06).

## 2026-10-05: Public launch

- ScamCam went live at https://scamcam.kevinle.tech on Cloudflare's free plan: one Worker named `scamcam` on a
  custom domain, a D1 database in Western North America with all 4 migrations applied, and cron jobs `17 3 * * *`
  and `41 4 * * 1`. There are no workers.dev or preview URLs.
- `npm run deploy` refuses placeholders, test keys, uncommitted changes, or a `main` that differs from GitHub, then
  runs every test, builds for production, and deploys. `npm run deploy:dry-run` does everything except the upload.
- A ScamCam Turnstile widget for `scamcam.kevinle.tech` only. Tokens are tied to the `scan` action and the
  hostname, as Cloudflare's integration guide recommends.
- The Phishing.Database sync is on, with a D1-only token in GitHub. The first sync loaded 392,063 entries in 1,024
  shards.
- The policy pages are published without draft labels, and the Privacy policy takes effect on October 5, 2026.
- Found at launch: the kevinle.tech zone's Web Analytics automatic setup injected Cloudflare's beacon into ScamCam's
  pages. ScamCam now sends `Cache-Control` with `no-transform`, which Cloudflare honors by leaving the response
  alone. The zone setting and the personal site are unchanged.
- After launch, the Worker warms up its patterns, rules, and report schema at startup and reads the IANA registry
  list without a schema, because a fresh process showed that most first-scan CPU time is one-time work (11.6 ms for
  the first scan, 0.2 ms after).
- The tab icon now matches the amber logo.
- Verified: `npm run check:live` passed against the live site. Security headers and `no-transform` were present on
  17 static paths and 4 API answers with no cookies, `security.txt` was served as `text/plain` with the old path
  redirecting, the API answered 403 without a bot check and for cross-site posts and 429 with `Retry-After` within
  15 scans, and the browser contacted only `scamcam.kevinle.tech` and `challenges.cloudflare.com` and stored only
  `scamcam-theme`. `kevinle.tech` and `www.kevinle.tech` still answer 200 with their own pages, and their DNS
  answers match the baseline taken before deployment.

## 2026-10-05: Security hardening review

- Workers Free plan limits: Safe Browsing answers stay per hash prefix in Worker memory, other lookups check memory
  before the shared cache, and a request makes at most 24 shared cache calls. A message with 20 links now uses 43 of
  the 50 subrequests instead of about 750. The daily cleanup shares 25 delete batches across tables and stays under
  35 queries.
- Abuse protection: one rate limit per IPv6 /64 with IPv4-mapped addresses counted as IPv4, `X-Forwarded-For`
  ignored, unknown request fields refused, provider and Turnstile answers read with size caps (64 KB to 1 MB), and
  request IDs always made by the Worker.
- Fast parsing: the link, email, and hidden-character patterns no longer scan backward across the message. The worst
  crafted input took about 23 ms before and now takes under 1 ms.
- Report links to URLhaus must be URLhaus's own `https` pages, and report source links must use `https`.
- Cloudflare's invocation logs are off, so logs hold only ScamCam's own fields.
- Monitoring: daily and weekly reports compare usage with each daily budget, count errors by code, failed and stuck
  runs, cleanup backlog, list age, and storage, and log an `alert` line for each problem.
- A real-browser privacy check (`npm run test:privacy`) and a backup and restore drill (`npm run test:recovery`), both
  in CI, plus a recovery runbook in [docs/RECOVERY.md](docs/RECOVERY.md).
- `security.txt` points to `/disclosure`, and `/security.txt` redirects to `/.well-known/security.txt`.
- Policy pages: the Privacy page gained the legal basis, where data is processed, and tracking by other companies,
  with corrected cache and log wording. The Terms gained AI and provider caveats, and the Acceptable use policy
  forbids steering the AI check.
- The open legal questions were researched and answered in [docs/COMPLIANCE_MATRIX.md](docs/COMPLIANCE_MATRIX.md).
  The strongest level is now "Listed as malicious", Google warnings link to Google's threat definitions, the Terms
  ask users under 18 to read them with a parent or guardian, and the disclosure safe harbor follows the disclose.io
  core terms.
- 11 findings fixed and mapped to the OWASP API Security Top 10 and ASVS 5.0 in
  [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).
- Verified: 411 Vitest tests in 24 files, 11 Node tests, 52 accessibility checks, the browser privacy check, and the
  restore drill pass locally and in CI. Planting a log leak or an unhashed cache key made the privacy tests fail, and
  the old patterns failed 8 of the new slow-input tests. 16 simultaneous scans from one address let exactly 10
  through in the local simulator. The restore drill matched all 7 tables. `npm audit` found 0 vulnerabilities.
- The disclosure contact works: `kevinle.tech` has MX, SPF, DKIM, and DMARC records, a test report sent from an
  outside address arrived, and the reply reached the outside inbox.

## 2026-10-05: AI step

- `@cf/qwen/qwen3-30b-a3b-fp8` on Workers AI (Apache 2.0) runs only for messages the rules cannot decide. It sees the
  message with emails, phone numbers, long codes, and invisible characters removed and links replaced by `[link]`.
  Names and usernames are not removed, and the pages say so.
- The model must answer with one known label. A match adds one strong warning, so a result can reach Suspicious with
  low confidence at most, and the AI never lowers a result.
- Calls are capped at 2,000 a day (migration `0004`), about 4,300 of the free 10,000 neurons, and refused when usage
  cannot be counted. Answers are remembered in memory for an hour.
- The vote rule no longer fires on "vote for me" unless a team, tournament, or link is involved.
- The Privacy and How it works pages describe the AI step, the cache, and Phishing.Database.
- Tests and CI use a fake model with remote bindings off (`SCAMCAM_LOCAL_ONLY=1`).
- OWASP Top 10 for LLM Applications 2026 ([docs/OWASP_LLM_TOP_10.md](docs/OWASP_LLM_TOP_10.md)): invisible
  characters (zero-width, tag characters, variation selectors, direction controls) are removed before analysis,
  display, and the AI and reported when they hide words or links. Text aimed at scam filters or AI checkers skips the
  AI and raises a warning. The AI pauses for a minute after three failures in a row. The list builder refuses more
  than 5,000,000 entries. CI verifies npm registry signatures, publishes a CycloneDX SBOM, and pins every GitHub
  Action to a commit.
- Fixed: Granite and Qwen3 answer in the OpenAI-style chat format, so both answer shapes are read now. Qwen3 ran out
  of tokens while thinking, so thinking is switched off with `/no_think` and any `<think>` block is stripped. The
  first prompt flagged three normal messages, so it now says a scam must push the reader toward a risky action. Raw
  invisible characters in three source and test files became visible `\u` escapes, and a test now refuses raw
  invisible or text direction characters in project files.
- Verified live through the local dev server: on the holdout set (20 scams and 20 normal messages, written before
  tuning and run once) the rules caught 3 of 20 scams and the rules with Qwen3 caught 16 of 20, with 0 false alarms.
  On the tuning set, Qwen3 caught 24 of 30 with 0 false alarms, against 6 of 30 for the rules alone. On the attack
  set, the checker guard raised injected scams caught from 12 of 14 to 14 of 14, and a fresh attack holdout ended at
  11 of 12. Full tables are in [docs/SCAMCAM_ANALYSIS.md](docs/SCAMCAM_ANALYSIS.md) and
  [docs/OWASP_LLM_TOP_10.md](docs/OWASP_LLM_TOP_10.md).
- 246 Vitest tests in 17 files and 7 Node tests passed with the AI step in place, and 284 Vitest tests in 20 files
  and 9 Node tests after the OWASP work.

## 2026-10-05: Caching and the Phishing.Database list

- Provider answers are cached under each provider's rules: Safe Browsing per hash prefix for Google's cache duration,
  including prefixes with no match, URLhaus for 15 minutes, RDAP registrations for a day and missing domains for an
  hour, DNS answers for their time to live, and the RDAP bootstrap for 12 hours. Keys are SHA-256 hashes, never the
  looked-up names, and failures are never cached.
- Identical lookups that run at the same time share one request, a repeated scan makes no outside calls, and daily
  budgets are charged only when a provider is actually asked.
- A source that fails three times in a row is paused for a minute, and a registry that answers 429 is left alone for
  as long as it asks (`Retry-After`, otherwise 5 minutes).
- `scripts/domain-list.ts` turns Phishing.Database's active list into 8-byte SHA-256 keys in 1,024 D1 rows
  (migration `0003`), and a scheduled GitHub workflow downloads it at a pinned commit, builds the rows, and uploads
  them. A match is a strong warning, never confirmation. Listed shared services are context only, official sites are
  never looked up, a copy older than 3 days is not used, and the copy is deleted 7 days after the last sync.
- The daily cleanup covers the list tables, and the weekly report shows the list's version, size, and age.
- The sync uses the full active list, because Phishing.Database's "new today" and "last hour" feeds stopped updating
  in December 2025.
- Verified: a repeated scan through Cloudflare's cache in workerd made 0 provider calls. A first scan makes 2.75
  outside calls on average and 5 at most, and the engine takes 1.25 ms per scan at the median and 3.12 ms at p95 in
  Node. The Worker is 1,224 KB (307 KB compressed) against the 3 MB compressed limit and used about 25 ms of CPU at
  startup in a local profile.
- Real-data benchmark: the active list (11.0 MB, commit `12a20bf`) built 392,063 keys in 1,024 shards and loaded into
  a local D1 in about 3 seconds. List entries now accept IPv4 addresses and host names with underscores. On a
  held-out sample run once with the rules only, the rules flagged 71 of 200 gaming-impersonation domains, 2 of 200
  random listed domains, and 0 of 178 legitimate sites.

## 2026-10-05: Detection engine

- `src/engine`, with no Worker-specific code: URL analysis with the Public Suffix List, look-alike and punycode
  checks, 18 message rules in 10 scam families, Safe Browsing v5, RDAP, DNS over HTTPS, URLhaus host lookups,
  scoring, verdicts, and recommendations. Details are in [docs/SCAMCAM_ANALYSIS.md](docs/SCAMCAM_ANALYSIS.md).
- `POST /api/v1/scans`: Turnstile required (fails closed), 10 scans per minute per visitor, Zod-validated input up to
  4,000 characters, and every report checked against its schema before it is returned, documented in OpenAPI.
- Daily caps of 8,000 Safe Browsing calls and 5,000 URLhaus calls, counted in the `provider_usage` table (migration
  `0002`) and cleaned up after 35 days.
- The Check button runs real scans through the Turnstile widget and shows the report under the scan box.
- Safe Browsing v5 answers are decoded as Protocol Buffers (`src/engine/protobuf.ts`), because `hashes:search`
  answers only in that format. Matches are ordered phishing first, then malware, unwanted software, and potentially
  harmful apps.
- Fixed: the Safe Browsing canonicalizer lowercases ASCII letters only, so international domains keep their bytes.
  Email redaction no longer hides the `@` trick, and raw IP links are recognized. Programs on user-upload hosts such
  as `cdn.discordapp.com` are no longer trusted just because the domain is official. Negated safety advice such as
  "never share your password" no longer matches the password-request rule.
- CI: the accessibility audit waits up to 60 seconds for headless Chrome on a fresh runner, and the Gitleaks job can
  read pull requests.
- Verified: 148 Vitest tests in 11 files and 5 config tests pass. The 69-case labeled benchmark scores precision
  1.000 and recall 1.000 (a tuning set, not an independent evaluation). All 35 of Google's canonicalization examples
  pass, and 52 of 52 accessibility checks pass, including 4 real scans. A real scan in headless Chrome of an "I
  accidentally reported you" message with a disguised link returned High risk with 6 exhibits. After a scan, a test
  searches every D1 table for the submitted text, and every outgoing request is checked for the link path, query, or
  message.
- Verified with live keys through the local dev server: Google's phishing and malware test pages came back High risk,
  an official Steam trade link came back No known threat detected, and Google's full hashes for its three test pages
  equal ScamCam's own SHA-256 hashes of them. Tests rose to 164 Vitest tests in 12 files.
- Repository: `main` is protected against force pushes and deletion. Dependabot updates of three GitHub Actions passed
  CI and were merged, and Vitest and `@types/node` stay on their current major versions (reasons in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## 2026-10-05: Website and design

- An evidence-room design: graphite and safety amber in the dark theme, warm photo paper in the light theme, Big
  Shoulders Stencil Display headlines with IBM Plex Sans and Mono (self-hosted OFL fonts), viewfinder brackets,
  exhibit tags, a verdict stamp, a five-step risk meter that always writes the level in words, and redaction bars.
- Pages: Check (with a guide to gaming scams), How it works, Privacy, Terms, Acceptable use, Cookies, Accessibility,
  Security, Vulnerability disclosure, Contact, and a 404 page.
- A scan panel with a live in-browser preview of the links it would check and the emails, phone numbers, and codes it
  would hide.
- The report layout: case number, stamp, risk meter, lettered exhibits with source and time, unchecked sources,
  recommendations, a disclaimer, and Google's attribution whenever Safe Browsing is used.
- `npm run test:a11y` runs axe-core (WCAG 2.0, 2.1, and 2.2, levels A and AA) in headless Chrome on every page, in
  both themes, at 1280 and 320 px, and in CI.
- Fixed: shared labels no longer pull all of Zod into the site, which cut its script from 113 KB to 89 KB gzip.
- Verified: 34 Vitest tests and 5 config tests pass, and 48 of 48 accessibility checks pass. Planting an image without
  alt text and low-contrast text made exactly those 4 checks fail.

## 2026-10-05: Foundation

- Planning documents written before any code: the project spec, architecture and threat model, license matrix, cost
  model, compliance and naming review, privacy design, data model, retention policy, analysis design, roadmap, and
  test plan.
- A React 19, TypeScript, Vite, and Tailwind 4 site shell with a dark theme, an optional light theme, a skip link,
  focus styles, and reduced motion support.
- One Worker with Hono and `@hono/zod-openapi`, serving `GET /api/v1/health` and `GET /api/v1/openapi.json`, with
  JSON 404 and 500 responses that reveal nothing internal.
- A strict CSP and security headers, HSTS, rejection of cross-site form posts, a 16 KB body limit, no CORS, 60 API
  requests per minute per client, a Turnstile helper that fails closed, and `/.well-known/security.txt`.
- D1 migration `0001_foundation.sql` (`error_events`, `maintenance_runs`, `app_state`) behind a repository layer.
- A daily cleanup at 03:17 UTC in bounded batches that pauses optional writes once storage passes 80 MB, and a weekly
  review on Mondays at 04:41 UTC.
- One JSON log line per API request, never with the IP address, URL, or query.
- GitHub Actions (generated-types check, type check, tests, build, `npm audit`, Gitleaks), Dependabot, and a
  Codespaces dev container with Node 24.
- Config tests that fail on a public deployment target, cron drift, an expired `security.txt`, a weakened CSP, or an
  em dash in any project file.
- Verified: 20 Worker tests in workerd with a local D1 and 5 config tests pass, and `npm audit` finds 0
  vulnerabilities after `@cloudflare/vitest-pool-workers` was replaced by `@cloudflare/vitest-plugin`. Making the 500
  handler leak the error message made its test fail. There is no sideways scrolling at 320 and 390 px, and the first
  push passed CI.
