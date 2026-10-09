# Status

Last updated: 2026-10-08.

What is live, where it runs, how it is checked, and what is still open. What shipped and when is in
[CHANGELOG.md](../CHANGELOG.md), and what comes next is in [ROADMAP.md](ROADMAP.md).

## Live service

ScamCam has been live at https://scamcam.kevinle.tech since 2026-10-05.

| Item | State |
|---|---|
| Worker | `scamcam`, deployed with `npm run deploy` (production environment), custom domain `scamcam.kevinle.tech`; no workers.dev or preview URLs |
| Plan | Cloudflare Workers Free and GitHub Free; operating cost $0 |
| Schedules | `17 3 * * *` (daily cleanup), `41 4 * * 1` (weekly review), and `*/5 * * * *` (expired share links) |
| Database | D1 `scamcam` in Western North America, created at launch with all 4 migrations of that time applied; share links added migration `0005` (`shared_reports`), and migration `0006` adds five more lists, the `phishstats` budget, and `result_flags` |
| Turnstile | A ScamCam widget for `scamcam.kevinle.tech` only; tokens are tied to the hostname and to the `scan` or `flag` action |
| Scam lists | Six lists synced by the "Scam list sync" workflow, scheduled for 07:37 UTC: Phishing.Database, MetaMask, ScamSniffer, PhishDestroy, DevSpen's Discord and Steam list, and CERT Polska. The first sync of all six ran at 02:49 UTC on 2026-10-07 in 1 minute 23 seconds (392,063, 102,885, 356,136, 216,485, 10,075, and 127,517 entries, 1,024 shards each). Phishing.Database has published nothing since 2026-10-02 15:30 UTC, and its issue tracker reports its site returning 503 errors, so reports say how old that copy is. GitHub blocked the PhishDestroy account on 2026-10-07 and the project moved to GitLab, so the sync reads that list from `gitlab.com/phishdestroy/destroylist` since 2026-10-08 |
| Policies | Published without draft labels; the current Privacy policy takes effect on October 8, 2026 (no session replay, Global Privacy Control, and outside code limited to the bot check) |
| Personal site | `kevinle.tech` answers 200 with its own pages and `www.kevinle.tech` redirects to it (301) since 2026-10-08; ScamCam changed neither |
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
| Link and message checks | 2026-10-05 | Look-alike and punycode checks, 48 message rules in 24 scam families (25 rules and 11 families for scams without links added 2026-10-07), Safe Browsing v5, URLhaus, RDAP, DNS, Phishing.Database, and scoring with sources and confidence (`SCAMCAM_ANALYSIS.md`) |
| AI step | 2026-10-05 | `@cf/qwen/qwen3-30b-a3b-fp8` for messages the rules cannot decide; one label, can add a warning but never lower a result, 2,000 calls a day |
| File checks | 2026-10-06 | "Check a file", paste, or drop: the browser finds the real type and warning signs and sends only fingerprints; MalwareBazaar, CIRCL hashlookup, and Team Cymru's Malware Hash Registry are checked ([SCAMCAM_ANALYSIS.md](SCAMCAM_ANALYSIS.md#file-checks-2026-10-06)) |
| Minecraft mods and modpacks | 2026-10-07 | Mods are read on the device for what account stealers do (login folders, webhooks, hidden downloads, anti-analysis checks, hidden commands, launcher accounts, the login token), then compared with Modrinth by SHA-1 and mod ID (a reviewed release public for two weeks with nothing malware-like reads "No known threat detected"; newer releases get no credit, against hacked developer accounts); `.mrpack` and CurseForge packs are checked for unsafe downloads and carried mods ([SCAMCAM_ANALYSIS.md](SCAMCAM_ANALYSIS.md#minecraft-mods-and-modpacks-2026-10-07)) |
| Breach check | 2026-10-08 | Since version `95e05196` (2026-10-08): a password strength estimate, a passphrase maker, a site lookup (2FA Directory, Passkeys Directory, Apple's change-password links, Have I Been Pwned, and Washington and California breach notices) searched in the browser, and lock-down steps for six platforms. Live since the morning: /breaches checks a password with Pwned Passwords by k-anonymity: the browser sends only the first 5 characters of its SHA-1 fingerprint to `GET /api/v1/passwords/range/{prefix}`, which asks with `Add-Padding`, adds its own random padding, keeps each answer a day in the Cache API, and allows 20 checks a minute per visitor (`PASSWORD_RATE_LIMITER`). It also searches Have I Been Pwned's public breach list in the browser (`GET /api/v1/breaches`, built by the scanner at most every 12 hours, kept in its storage and for 6 hours at the edge). Link reports mention a known breach of the link's site as context, from the scanner's stored copy only. Email addresses are not checked ([API_LICENSE_MATRIX.md](API_LICENSE_MATRIX.md)) |
| GitHub repository facts | 2026-10-08 | In the scanner, for one github.com, raw.githubusercontent.com, codeload.github.com, or github.io link per scan: when the repository and its owner were made, stars, forks, archived, and whether GitHub removed (404) or blocked (451) it. A new repository or owner is a weak sign; a removed or blocked repository a moderate one; stars never lower the risk. Starts once `GITHUB_API_TOKEN` is set. Roblox profile checks are not built ([API_LICENSE_MATRIX.md](API_LICENSE_MATRIX.md)) |
| Report it and Totals | 2026-10-07 | Suspicious or worse reports offer a copy-ready summary and the right places to report; /stats shows anonymous 7 and 30 day totals from `scan_totals` (migration `0009`, applied to production 2026-10-07) |
| Browser extension | 2026-10-07 | `extension/`: right-click or toolbar "Check with ScamCam" opens the site with the text after `#check=`; no host permissions, nothing stored; manual install from /extension until the Edge Add-ons listing is approved ([EDGE-LISTING.md](EDGE-LISTING.md)) |
| Screenshot reading | 2026-10-06 | "Read a screenshot", paste, or drop: the browser reads the text (Tesseract.js 7.0.0, English `best_int` model) and any QR code (jsQR 1.4.0), inverts dark-mode screenshots first, and adds the text to the box for review |
| Share links | 2026-10-06 | Share on a report: 5, 10, or 15 minutes (10 by default), message text only if ticked; the link opens a read-only snapshot with its expiry |
| Scanner Durable Object | 2026-10-06 | Scans run in the `Scanner` Durable Object with 30 seconds of CPU per request; the Worker keeps the bot check, rate limits, and signing, and falls back to scanning itself |
| Result flags | 2026-10-06 | "Flag result as incorrect" on every report: four reasons and a short note, kept 30 days for my review with `npm run flags`; never read by the scan engine |
| More scam lists | 2026-10-06 | MetaMask, ScamSniffer, PhishDestroy, DevSpen's Discord and Steam list, and CERT Polska, next to Phishing.Database, checked in two D1 queries |
| Spamhaus, PhishStats, Cloudflare Radar | 2026-10-06 | In the scanner; each starts once its secret is set |
| Phone numbers and callback scams | 2026-10-06 | Fake order and voicemail callback rules, and US numbers compared with a hashed copy of the FTC's Do Not Call reports, never sent anywhere |
| Discord invites and Steam accounts | 2026-10-07 | In the scanner. Both work live: Steam with `STEAM_WEB_API_KEY`, and Discord with `DISCORD_BOT_TOKEN`, after the first lookup without a token answered 429 because Workers share addresses |
| Scam wallets and FCC numbers | 2026-10-07 | ScamSniffer's scam wallets and the FCC's unwanted-call complaint numbers as hashed lists in D1; both caught in live scans on 2026-10-07 |
| Email files | 2026-10-07 | A saved .eml is read on the device; only its text, the sender's domain, the sender check results, and attachment types and findings are sent |
| More file types | 2026-10-07 | Browser extensions and their permissions, PyInstaller programs, remote shortcuts, startup .reg files, .appinstaller and MSIX, CHM, and Roblox model backdoors |
| Outside checkers | 2026-10-06 | Reports link to VirusTotal, Google, urlscan.io, Cisco Talos, ScamAdviser, URLVoid, and Hybrid Analysis for the visitor to open |
| Newer checks | 2026-10-06 | Redirect wrappers decoded, Cloudflare's 1.1.1.2 security filter, copy-paste command, command, wallet, and reply-to-activate rules, brand mismatch between a message and its links, and abused endings ([SCAMCAM_ANALYSIS.md](SCAMCAM_ANALYSIS.md#checks-added-on-2026-10-06)) |

### Screenshot reading

| Item | State |
|---|---|
| Files | Self-hosted under `/ocr/7.0.0-2/` with a one-year immutable cache: the worker (111 KB), three WebAssembly builds (about 3.9 MB each; a browser loads one), the model (2.95 MB), and license texts. A first screenshot downloads about 7 MB once |
| Privacy | No upload, no storage, no outside requests; the browser check proves it for the page and the OCR worker |
| Security | See [SECURITY_REVIEW.md](SECURITY_REVIEW.md#screenshot-reading-2026-10-06) |

### Result flags

| Item | State |
|---|---|
| Storage | `result_flags` (migration `0006`): verdict, finding IDs, domain or file fingerprint, reason, and redacted note; one per report; 30 days |
| Abuse limits | Turnstile with the `flag` action, a report signed in the last 24 hours, 3 a minute per visitor, 200 a day (`FLAG_DAILY_LIMIT`), and nothing while writes are paused |
| Review | `npm run flags` lists waiting flags from production D1, and `npm run flags -- --done <id>` removes one; weekly maintenance raises `flags_waiting` |
| Security | See [SECURITY_REVIEW.md](SECURITY_REVIEW.md#result-flags) |

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
| abuse.ch ThreatFox | The registrable domain only, from the scanner | Working with the existing abuse.ch Auth-Key; shares the abuse.ch daily budget |
| abuse.ch URLhaus | The hostname only | Key set in production; verified live from the local dev server on 2026-10-05 (only "no results" answers seen live); capped at 5,000 calls a day |
| RDAP | The registrable domain only | Working; cached, with back-off on 429 |
| Cloudflare DNS over HTTPS | The hostname only, now through the 1.1.1.2 security resolver, which also gives the block result | Working |
| MalwareBazaar (abuse.ch) | A file's SHA-256 | Working with the existing abuse.ch Auth-Key (checked locally on 2026-10-06); shares the abuse.ch daily budget |
| CIRCL hashlookup | A file's SHA-256 | Working, no key (checked locally on 2026-10-06) |
| Team Cymru Malware Hash Registry | A file's SHA-1, through Cloudflare DNS | Working, no key (checked locally on 2026-10-06) |
| Modrinth | A Minecraft mod's SHA-1 and the mod ID it names, or the SHA-1s of up to 50 mods a modpack carries or downloads from outside Modrinth | Working, no key (checked live on 2026-10-07: a Sodium release matched and a made-up fingerprint returned 404) |
| Cloudflare 1.1.1.2 security DNS | The hostname only | Working; verified locally on 2026-10-06 against Cloudflare's own blocked test hosts |
| Phishing.Database, MetaMask, ScamSniffer, PhishDestroy, DevSpen, CERT Polska | Nothing from visitors; a GitHub Actions job downloads the public lists | All six synced to production on 2026-10-07; matches are a strong warning, never confirmation |
| Spamhaus DQS (DBL and ZRD) | The registrable domain inside the query name, through Cloudflare's DNS over HTTPS resolver | Working: a live scan of `dbltest.com` on 2026-10-06 showed Spamhaus's spam listing. Direct TCP to Spamhaus's servers is blocked by Cloudflare in production, which is why lookups use Cloudflare's resolver |
| PhishStats | The registrable domain, or the exact host for shared hosting | Working: a live scan of a reported `pages.dev` site on 2026-10-06 showed its PhishStats report. Shared hosting lookups use a "starts with" search (0.2 s), since a "contains" search took 5.4 s; capped at 140 calls a day |
| Cloudflare Radar | The registrable domain only | Token set on 2026-10-06; confirmed live with a scan of `wikipedia.org` |
| Discord invite endpoint | The invite code only, from the scanner, with ScamCam's bot token | Working: a live scan of `discord.gg/minecraft` on 2026-10-07 showed "Discord has verified this server". Without the token, the first live lookup answered 429 |
| Bitly and is.gd/v.gd link expansion | Only the short code of their own links, from the scanner | Built 2026-10-07 with my Bitly token; tested with a fake server, answer formats checked live |
| Steam Web API | The profile name or account number only, from the scanner | Key set on 2026-10-07; a live scan of a real profile reached Steam without errors |
| ScamSniffer scam wallets and FCC consumer complaints | Nothing from visitors; the sync downloads them | Synced to production on 2026-10-07 (4,599 wallets, 28,734 numbers); both matched in live scans |
| GitHub REST API (`repos`, `users`) | The repository owner and name, or the account name, from the scanner, with ScamCam's token | Live since 2026-10-08 with `GITHUB_API_TOKEN` set; tested with a fake server, and GitHub's real answers checked by hand for a public repository |
| Pwned Passwords (Have I Been Pwned) | The first 5 characters of a password's SHA-1 fingerprint, from the Worker, never the visitor's address | Live since 2026-10-08, no key; production answered a range with 2,244 lines including padding |
| Have I Been Pwned breach list | Nothing from visitors; the scanner downloads the public list | Live since 2026-10-08, no key; 1,042 breaches (1.1 MB) on 2026-10-08, 191 KB once compacted; CC BY 4.0, credited with a link wherever it is shown |
| Workers AI (`@cf/qwen/qwen3-30b-a3b-fp8`) | The redacted message with links replaced by `[link]` | On, capped at 2,000 calls a day |
| Cloudflare Turnstile | The token and the visitor's IP address | Production widget |

Terms and limits for every source are in [API_LICENSE_MATRIX.md](API_LICENSE_MATRIX.md).

### Secrets (names only)

| Where | Names |
|---|---|
| Worker secrets (production) | `TURNSTILE_SECRET_KEY`, `SAFE_BROWSING_API_KEY`, and `URLHAUS_AUTH_KEY`, which I typed in myself at launch, and `SHARE_SIGNING_KEY` for share links and flags ([DEPLOYMENT.md](DEPLOYMENT.md), step 8) |
| Worker secrets for the extra sources | `SPAMHAUS_DQS_KEY`, `PHISHSTATS_API_KEY`, and `CLOUDFLARE_RADAR_TOKEN`, which I typed in myself on 2026-10-06 ([DEPLOYMENT.md](DEPLOYMENT.md), step 11), `STEAM_WEB_API_KEY`, `DISCORD_BOT_TOKEN`, and `BITLY_TOKEN` (all 2026-10-07, step 12); `GITHUB_API_TOKEN` is not set yet (step 14) |
| GitHub secrets | `CLOUDFLARE_D1_TOKEN` (D1 Edit only) and `CLOUDFLARE_ACCOUNT_ID` |
| GitHub variable | `PHISHING_DATABASE_SYNC=enabled` |
| Local | `.dev.vars`, ignored by git; `.dev.vars.example` holds only Cloudflare's public Turnstile test keys, a local-only signing key, and empty placeholders |

## Tests

### Current totals

| Check | Latest recorded result |
|---|---|
| Vitest (worker, engine, and client projects) | 890 tests in 60 files pass (2026-10-09, with file names in screenshots no longer read as websites) |
| Node config and script tests (`npm run test:config`) | 34 pass, including the sitemap matching the page list, the Wikidata brand check, the site data build, and the disposable email list (2026-10-08) |
| Accessibility (`npm run test:a11y`) | Passes; 72 axe-core checks, including the open flag form, the email details box, and the breach page with a password answer and search results, in both themes at both widths (2026-10-08) |
| Privacy and headers (`npm run test:privacy`) | Passes, including the screenshot, file, Minecraft mod, email file, flag (scan, flag, confirmation), share, and breach check steps (only 5 characters of the password's fingerprint sent; search words never sent) |
| Recovery drill (`npm run test:recovery`) | All 9 tables matched after export and restore, including shared reports, flags, two lists, and eight migrations; export 1.1 s (646 KB), restore 3.3 s (2026-10-07) |
| `npm audit` | 0 vulnerabilities (2026-10-05) |

How each suite runs is in [TEST_PLAN.md](TEST_PLAN.md).

### Free plan limits, measured locally (2026-10-05)

| Check | Result |
|---|---|
| Subrequests | 6.7 per cold scan on average for the benchmark (most 13), 31 for 20 links in the engine, 39 for 20 links through the whole Worker route (12 fetches, 20 cache calls, 7 queries; the anonymous totals counter added a query on 2026-10-07), 29 for 20 links in the scanner with every source on (17 fetches, 6 Spamhaus lookups, 6 queries), and 38 when two of the links are Discord invites, two Steam profiles, two Bitly links, and one a GitHub repository (27 fetches, 6 Spamhaus lookups, 5 queries; 39 if the budget counts need a sixth query), measured on 2026-10-08; 0 for a warm repeat. A password check uses at most 3 and the breach list at most 3 |
| Slow inputs | The slowest crafted input scans in under 1 ms in Node; before the fix the worst took about 23 ms |
| Concurrency | 16 simultaneous scans from one address: exactly 10 allowed (local simulator) |
| Cleanup | 10,250 expired rows in one table: 10,000 removed on the first run, 250 on the next. With a backlog in every table: 11,000 rows in 26 batches, fewer than 35 queries |

### Benchmarks

| Set | Result |
|---|---|
| Tuning benchmark (69 labeled cases, outside sources off) | Precision 1.000, recall 1.000; a tuning set, not an independent evaluation |
| Held-out domains from Phishing.Database (rules only, one run) | Fresh sample (seed 20261007): 94 of 200 gaming-impersonation domains flagged (53 with the rules before 2026-10-07) and 0 of 200 random domains; 0 of 178 legitimate sites flagged. The first sample (seed 20261005) is now a tuning set: 127 of 200, up from 71 |
| Real Minecraft files from Modrinth (one run, 2026-10-07) | 61 files: none flagged; 5 login-token tools would be Suspicious, never High risk, if Modrinth did not have the exact file; slowest 3.1 s (Essential, 51 MB) |
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
on scripts and styles. It passed again after the flags and lists release on 2026-10-06, and the new `/api/v1/flags`
route answered 400 to an invalid body.

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

1. Watch the first daily and weekly maintenance reports for alerts ([RECOVERY.md](RECOVERY.md#alerts)). The site
   launched after the 2026-10-06 03:17 UTC slot, so the first daily run is 2026-10-07 and the first weekly run is
   2026-10-12.
2. The three rule gaps from the held-out benchmark were closed on 2026-10-07 and measured on a fresh sample.
3. Restore points: confirmed on 2026-10-06, when `npx wrangler d1 time-travel info scamcam --env production` returned
   a current bookmark.
4. Phishing.Database has published nothing since 2026-10-02. Reports keep using that copy for 30 days after its last
   update (until 2026-11-01) and say how old it is; the weekly report raises `phishing_list_stale` after 21 days.
5. Ask abuse.ch (contact form) to confirm that showing per-lookup results with credit is fine, and ask Team Cymru
   (support@cymru.com) the same for the Malware Hash Registry.
6. Review flags with `npm run flags` whenever the weekly report raises `flags_waiting`.
7. The breach check, GitHub repository facts, and the PlayStation domain from the Wikidata review went live on
   2026-10-08 as version `9a44ad58`, with `GITHUB_API_TOKEN` set and the `PASSWORD_RATE_LIMITER` binding added.
   `npm run check:live` passed, including a password check that sent only 5 characters of its fingerprint. Run one
   scan with a GitHub link by hand, because Turnstile does not finish in the headless check. The GitHub token's
   expiry date is noted outside the repository; renew it before then ([DEPLOYMENT.md](DEPLOYMENT.md), step 14).
8. The site lookup, password tools, login token removal, and sender checks went live on 2026-10-08 as version
   `95e05196`, after migration `0010` was applied; a manual "Scam list sync" run built the lookup data, and
   `npm run check:live` passed. Refresh the bundled throwaway email list now and then with `npm run lists:disposable`.

### Not verified yet

- A live site lookup in a real browser by hand. The first remote build (workflow run 37860517483, 2026-10-08 23:38 UTC)
  wrote 3,798 sites and 7,022 notices, and both endpoints served the decoded files, but `check:live` reached them before
  the build finished.
- Subrequest counts are measured locally (39 for a 20-link scan in the Worker, 29 in the scanner, 38 with accounts,
  short links, and a GitHub repository) but not yet recorded on Cloudflare.
- GitHub's answers for live repositories, including a real 451 block, have not been seen; they are tested with a fake
  server built from GitHub's documented fields.
- The rate limiting binding counts per Cloudflare location and is eventually consistent, so the concurrency result
  comes from the local simulator only. The live check saw a 429 within 15 scans.
- A live Steam ban result and whether `timecreated` comes back for public profiles (Valve's current reference does
  not show it; reports skip the account age when it is missing).
- Modrinth's rate limit (300 requests a minute per address) from Cloudflare's shared addresses; a refusal shows as
  Not checked.
- A live URLhaus match. Only "no results" answers have been seen live; matches are tested with a fake server.
- Google's `CANARY` and `FRAME_ONLY` attributes. They have not appeared live and are tested with encoded examples.
- The Cache API was tested in local workerd only; production behavior (per data center, eviction) is untested.
- Have I Been Pwned's rate limit for the breach list without a key, from Cloudflare's shared addresses. The first
  live request on 2026-10-08 was answered, and `/api/v1/breaches` served 1,042 breaches (190,968 bytes); whether that
  copy came from the scanner's storage or the Worker fallback was not recorded.
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

The three gaps the first held-out sample showed (a brand name in front of an unrelated site, brand plus gift words,
and brand words on free blog hosting) were closed on 2026-10-07. On the fresh sample, the rules alone still miss 106
of 200 gaming-impersonation domains. Most are a common game name in front of an unrelated site on an ordinary ending,
such as `discord.<site>.cc`, which stays Unknown because communities use the same pattern for their own invite pages,
and misspellings with several swapped letters, such as `steamcomnniuty`. Rules alone caught only 15 to 20 percent of
naturally worded scams in the AI sets, although they score 100 percent on their own tuning set. Mod checks read text
in class files; a stealer that encrypts its strings is only caught by the malware lists or the Modrinth comparison.

## Cost and quota use

$0. Everything runs on free plans. Local testing on 2026-10-05 used about 334 Workers AI neurons of the free 10,000 a
day, plus a few dozen Safe Browsing and URLhaus calls. The limits and controls are in [COST_MODEL.md](COST_MODEL.md).
