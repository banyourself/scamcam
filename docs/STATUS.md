# Status

Last updated: 2026-10-06.

What is live, where it runs, how it is checked, and what is still open. What shipped and when is in
[CHANGELOG.md](../CHANGELOG.md), and what comes next is in [ROADMAP.md](ROADMAP.md).

## Live service

ScamCam has been live at https://scamcam.kevinle.tech since 2026-10-05.

| Item | State |
|---|---|
| Worker | `scamcam`, deployed with `npm run deploy` (production environment), custom domain `scamcam.kevinle.tech`; no workers.dev or preview URLs |
| Plan | Cloudflare Workers Free and GitHub Free; operating cost $0 |
| Schedules | `17 3 * * *` (daily cleanup), `41 4 * * 1` (weekly review), and `*/5 * * * *` (expired share links) |
| Database | D1 `scamcam` in Western North America, created at launch with all 4 migrations of that time applied; share links added migration `0005` (`shared_reports`) |
| Turnstile | A ScamCam widget for `scamcam.kevinle.tech` only; tokens are tied to the `scan` action and the hostname |
| Phishing.Database | Synced by a GitHub Actions workflow at 07:37 UTC; the first sync loaded 392,063 entries in 1,024 shards |
| Policies | Published without draft labels; the Privacy policy takes effect on October 5, 2026 |
| Personal site | `kevinle.tech` and `www.kevinle.tech` still answer 200 with their own pages; their DNS answers matched the baseline taken before deployment |
| Repository | `banyourself/scamcam` on GitHub with a protected `main` branch (no force pushes or deletion, also for admins); CI jobs `check` (with the restore drill), `accessibility`, `privacy`, and `secrets` |

### Analytics injection found at launch

The kevinle.tech zone has Cloudflare Web Analytics automatic setup, so Cloudflare injected its analytics beacon into
ScamCam's pages. ScamCam's pages, `security.txt`, and API answers now send `Cache-Control` with `no-transform`, which
Cloudflare honors by not rewriting them. Scripts, styles, and OCR files under `/assets/` and `/ocr/` leave it out so
that Cloudflare can still compress them; the analytics beacon is injected only into pages. The zone setting and the
personal site are unchanged, and the live check confirms that no analytics request is made.

## Features

| Feature | Live since | State |
|---|---|---|
| Link and message checks | 2026-10-05 | Look-alike and punycode checks, 18 message rules in 10 scam families, Safe Browsing v5, URLhaus, RDAP, DNS, Phishing.Database, and scoring with sources and confidence (`SCAMCAM_ANALYSIS.md`) |
| AI step | 2026-10-05 | `@cf/qwen/qwen3-30b-a3b-fp8` for messages the rules cannot decide; one label, can add a warning but never lower a result, 2,000 calls a day |
| Screenshot reading | 2026-10-06 | "Read a screenshot", paste, or drop: the browser reads the text (Tesseract.js 7.0.0, English `best_int` model) and any QR code (jsQR 1.4.0), inverts dark-mode screenshots first, and adds the text to the box for review |
| Share links | 2026-10-06 | Share on a report: 5, 10, or 15 minutes (10 by default), message text only if ticked; the link opens a read-only snapshot with its expiry |
| Scanner Durable Object | 2026-10-06 | Scans run in the `Scanner` Durable Object with 30 seconds of CPU per request; the Worker keeps the bot check, rate limits, and signing, and falls back to scanning itself |
| Newer checks | 2026-10-06 | Redirect wrappers decoded, Cloudflare's 1.1.1.2 security filter, copy-paste command, command, wallet, and reply-to-activate rules, brand mismatch between a message and its links, and abused endings ([SCAMCAM_ANALYSIS.md](SCAMCAM_ANALYSIS.md#checks-added-on-2026-10-06)) |

### Screenshot reading

| Item | State |
|---|---|
| Files | Self-hosted under `/ocr/7.0.0-2/` with a one-year immutable cache: the worker (111 KB), three WebAssembly builds (about 3.9 MB each; a browser loads one), the model (2.95 MB), and license texts. A first screenshot downloads about 7 MB once |
| Privacy | No upload, no storage, no outside requests; the browser check proves it for the page and the OCR worker |
| Security | See [SECURITY_REVIEW.md](SECURITY_REVIEW.md#screenshot-reading-2026-10-06) |

### Share links

| Item | State |
|---|---|
| Storage | `shared_reports` (migration `0005`): AES-GCM ciphertext only; the key lives in the link after `#` |
| Authenticity | Scan answers carry an HMAC-SHA256 signature (`X-Report-Signature`); shares need it, unchanged, within 30 minutes |
| Cleanup | A cron every 5 minutes deletes expired shares; reads refuse them |
| Limits | 10 share links a minute per visitor, 2,000 active at most, 16 KB bodies |
| Security | See [SECURITY_REVIEW.md](SECURITY_REVIEW.md#share-links-2026-10-06) |

## Sources and secrets

### Sources

| Source | Receives | State |
|---|---|---|
| Public Suffix List (`tldts` 7.4.16) | Nothing, bundled | Working |
| Google Safe Browsing v5 | 4-byte hash prefixes only | Key set in production; verified live from the local dev server on 2026-10-05; capped at 8,000 calls a day |
| abuse.ch URLhaus | The hostname only | Key set in production; verified live from the local dev server on 2026-10-05 (only "no results" answers seen live); capped at 5,000 calls a day |
| RDAP | The registrable domain only | Working; cached, with back-off on 429 |
| Cloudflare DNS over HTTPS | The hostname only | Working |
| Cloudflare 1.1.1.2 security DNS | The hostname only | Working; verified locally on 2026-10-06 against Cloudflare's own blocked test hosts |
| Phishing.Database | Nothing from visitors; a GitHub Actions job downloads the public list | Synced; matches are a strong warning, never confirmation |
| Workers AI (`@cf/qwen/qwen3-30b-a3b-fp8`) | The redacted message with links replaced by `[link]` | On, capped at 2,000 calls a day |
| Cloudflare Turnstile | The token and the visitor's IP address | Production widget |

Terms and limits for every source are in [API_LICENSE_MATRIX.md](API_LICENSE_MATRIX.md).

### Secrets (names only)

| Where | Names |
|---|---|
| Worker secrets (production) | `TURNSTILE_SECRET_KEY`, `SAFE_BROWSING_API_KEY`, and `URLHAUS_AUTH_KEY`, which I typed in myself at launch, and `SHARE_SIGNING_KEY` for share links ([DEPLOYMENT.md](DEPLOYMENT.md), step 8) |
| GitHub secrets | `CLOUDFLARE_D1_TOKEN` (D1 Edit only) and `CLOUDFLARE_ACCOUNT_ID` |
| GitHub variable | `PHISHING_DATABASE_SYNC=enabled` |
| Local | `.dev.vars`, ignored by git; `.dev.vars.example` holds only Cloudflare's public Turnstile test keys |

## Tests

### Current totals

| Check | Latest recorded result |
|---|---|
| Vitest (worker, engine, and client projects) | 503 tests in 30 files pass (2026-10-06, with the QR code fixes) |
| Node config and script tests (`npm run test:config`) | 14 pass |
| Accessibility (`npm run test:a11y`) | Passes; 52 axe-core checks were recorded with screenshot reading |
| Privacy and headers (`npm run test:privacy`) | Passes, including the screenshot step and the share step (scan, share, open) |
| Recovery drill (`npm run test:recovery`) | All 7 tables matched after export and restore; export about 1 to 1.5 s (469 KB), restore about 2 to 3 s (2026-10-05) |
| `npm audit` | 0 vulnerabilities (2026-10-05) |

How each suite runs is in [TEST_PLAN.md](TEST_PLAN.md).

### Free plan limits, measured locally (2026-10-05)

| Check | Result |
|---|---|
| Subrequests | 6.7 per cold scan on average for the benchmark (most 13), 31 for 20 links in the engine, 43 for 20 links through the whole route; 0 for a warm repeat |
| Slow inputs | The slowest crafted input scans in under 1 ms in Node; before the fix the worst took about 23 ms |
| Concurrency | 16 simultaneous scans from one address: exactly 10 allowed (local simulator) |
| Cleanup | 10,250 expired rows in one table: 10,000 removed on the first run, 250 on the next. With a backlog in every table: 11,000 rows in 25 batches, fewer than 35 queries |

### Benchmarks

| Set | Result |
|---|---|
| Tuning benchmark (69 labeled cases, outside sources off) | Precision 1.000, recall 1.000; a tuning set, not an independent evaluation |
| Held-out domains from Phishing.Database (rules only, one run) | 71 of 200 gaming-impersonation domains and 2 of 200 random domains flagged; 0 of 178 legitimate sites flagged |
| AI holdout (20 scams, 20 normal messages) | Rules only: 3 of 20 scams caught. Rules and Qwen3: 16 of 20, with 0 false alarms |

Full tables are in [SCAMCAM_ANALYSIS.md](SCAMCAM_ANALYSIS.md) and [OWASP_LLM_TOP_10.md](OWASP_LLM_TOP_10.md).

## Live check (`npm run check:live`, 2026-10-05)

| Check | Result |
|---|---|
| Headers | CSP, HSTS, frame protection, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, and `no-transform` on 17 static paths and 4 API answers; no cookies |
| `security.txt` | Served as `text/plain`, with the old path redirecting |
| API | Production settings and the real widget, 403 without a bot check, 403 for cross-site posts, 429 with `Retry-After` within 15 scans |
| Browser | Only `scamcam.kevinle.tech` and `challenges.cloudflare.com` contacted, no cookies, only `scamcam-theme` stored |
| Scan | Turnstile does not finish in a headless browser, so a real scan is checked by hand |

Since 2026-10-06 the live check also runs the screenshot step, and it requires `no-transform` on pages and its absence
on scripts and styles.

## Open items

### CPU time on the Free plan (fixed)

The first live scans used 11 to 29 ms of CPU against the Free plan's 10 ms per request; a health check uses 0 to
5 ms. Cloudflare tolerates occasional overruns but stops a Worker that goes over consistently. A fresh process showed
the cost is mostly one-time work (11.6 ms for the first scan, 0.2 ms after), so the Worker now warms up its patterns,
rules, and report schema at startup, and reads the IANA registry list without a schema. Three real scans watched with
`wrangler tail` on 2026-10-06 used 9 ms (a message), 16 ms (a link), and 26 ms (a link plus the AI step), down from
11, 29, and 18 ms. All three succeeded, but scans with links still went over 10 ms, so the scan engine now runs in
the `Scanner` Durable Object, which the Free plan gives 30 seconds of CPU per request. The Worker's own part (rate
limit, Turnstile, the scanner call, signing) still has to fit in 10 ms. Three real scans after the move used 7, 6, and
1 ms in the Worker and 22, 17, and 0 ms in the scanner. Each scan with lookups kept the scanner busy for about 5
seconds after it answered, because unfinished timeout timers kept it active, which spends the free Durable Object
duration about ten times faster than needed. Every lookup now clears its timer when it finishes.

### To do after launch

1. Watch the first daily and weekly maintenance reports for alerts ([RECOVERY.md](RECOVERY.md#alerts)).
2. Close the three rule gaps from the held-out benchmark (below) with a fresh sample from the list.
3. Run `npx wrangler d1 time-travel info scamcam` on the live database to confirm that restore points exist; no
   result is recorded yet.

### Not verified yet

- Subrequest counts are measured locally (43 for a 20-link scan) but not yet recorded on Cloudflare.
- The rate limiting binding counts per Cloudflare location and is eventually consistent, so the concurrency result
  comes from the local simulator only. The live check saw a 429 within 15 scans.
- A live URLhaus match. Only "no results" answers have been seen live; matches are tested with a fake server.
- Google's `CANARY` and `FRAME_ONLY` attributes. They have not appeared live and are tested with encoded examples.
- The Cache API was tested in local workerd only; production behavior (per data center, eviction) is untested.
- RDAP and DNS were called live only from local runs; registry rate limits in production are unknown.
- The `databaseSizeBytes` check relies on D1's `meta.size_after`; it works locally, and production behavior is not
  yet verified.
- Workers AI was evaluated through the local dev server's remote binding, not from the deployed Worker.
- The AI sets are small and hand-written. Zero false alarms in 50 normal messages still allows a real rate of a few
  percent.

### Reviews not done

- No lawyer or law school clinic has reviewed the policy pages. The open questions were researched instead
  ([COMPLIANCE_MATRIX.md](COMPLIANCE_MATRIX.md)).
- No independent penetration test.
- No manual screen reader review; automated checks cannot catch everything.
- The trademark search for "SCAM CAM" (with a space) has not been run, nor has a design mark search, which is needed
  only if a logo is adopted.

### Known detection gaps

The held-out benchmark showed three gaps in the rules: a brand name used as a subdomain of an unrelated site
(`discord.<site>.com`), a brand plus gift words on cheap endings (`discords-gift.eu`), and brand words on free blog
hosting (`getrobux-here.blogspot.be`). With the real list loaded, three of those missed domains came back Suspicious
through the Phishing.Database match, and steamgifts.com stayed No known threat. Rules alone caught only 15 to 20
percent of naturally worded scams in the AI sets, although they score 100 percent on their own tuning set.

## Cost and quota use

$0. Everything runs on free plans. Local testing on 2026-10-05 used about 334 Workers AI neurons of the free 10,000 a
day, plus a few dozen Safe Browsing and URLhaus calls. The limits and controls are in [COST_MODEL.md](COST_MODEL.md).
