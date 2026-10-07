# Changelog

What shipped in ScamCam and how it was verified, newest first. Dates come from the commit history. The current
state, test totals, and open items are in [docs/STATUS.md](docs/STATUS.md).

## 2026-10-07: More room under the Free plan's 50 subrequests

- **One DNS lookup per host instead of two.** Cloudflare's 1.1.1.2 security resolver answers normally for every name
  it does not block, so its answer now also tells whether a site exists and where it points. The separate 1.1.1.1
  lookup is gone, saving up to 3 subrequests per scan; a blocked site skips the existence check, since the block is
  the stronger signal.
- **Budget counts that arrive together share one query.** Each call to a budgeted source (Safe Browsing, URLhaus and
  ThreatFox, PhishStats, Workers AI) used to record itself with its own D1 query. Requests that arrive in the same
  moment are now counted together, still exactly, and URLhaus and ThreatFox look up their up to three hosts in
  parallel so their counts arrive together. D1 queries per scan fell from 14 to 6 in the scanner and from 9 to 6 in
  the Worker fallback.
- **Result for a 20-link scan:** 38 subrequests in the Worker fallback (was 44), 29 in the scanner with every source on
  (was 40), and 37 with two Discord invites, two Steam profiles, and two Bitly links (was 48).
- Cloudflare documents that Durable Objects have "the same per invocation" limits as Workers, so each call into the
  scanner gets its own 50. If more live sources are added later, part of a scan can run in a second scanner call
  instead of moving to a paid plan.
- Verified: 735 Vitest tests in 46 files and 19 Node tests pass, including new budget tests (three requests at once
  with a limit of 2 count as 3 in one query and only two are allowed).

## 2026-10-07: Short link expansion

- **Bitly, is.gd, and v.gd links now show where they lead.** The scanner asks the shortening service itself, through
  its official API, which address a short code points to: Bitly's `v4/expand` with my free token (`BITLY_TOKEN`), and
  is.gd's and v.gd's `forward.php` lookup, which needs no key. The destination is then checked like any other link,
  including redirect wrappers behind it, and the "a short link hides where it really goes" warning is replaced by
  "Bitly says this short link goes to ...". Neither the short link nor the destination is ever opened.
- A link that is.gd has disabled for abuse (its error code 2) is a strong warning; a code that does not exist is
  noted. At most two short links are expanded per scan, answers are kept in memory for 6 hours, and the Worker
  fallback skips expansion.
- A 20-link scan in the scanner with two Discord invites, two Steam profiles, and two Bitly links uses 48 of the 50
  subrequests (28 fetches, 6 Spamhaus lookups, 14 queries), so the next outside source must replace a fetch rather than
  add one, unless the plan changes.
- Verified: the is.gd and v.gd answer formats and Bitly's endpoint (401 without a token) were checked live from my
  computer; expansion is tested with a fake server until the first live scan.

## 2026-10-07: Rules for scams that often come without a link

- **Why.** The FBI's 2025 Internet Crime Report puts investment scams at $8.65 billion lost, business email scams at
  $3.05 billion, and tech support scams at $2.13 billion, and the FTC counted text messages as the most reported way
  scammers made contact in 2025. Many of these messages have no link, so link checks never see them.
- **25 new rules in 11 new scam families,** each with its own advice:
  - investment and crypto trading: guaranteed returns, a fee or tax to withdraw, VIP groups and mentors, trading apps;
  - fake bank fraud alerts: "Reply YES or NO" (moderate, because real banks send these too) and moving money to a
    "safe account";
  - government and police impersonation: suspended Social Security numbers, missed jury duty, warrants, and agencies
    asking for gift cards, crypto, or fines;
  - fake tech support: "your computer has been blocked, call this number" and requests to install AnyDesk,
    TeamViewer, or similar apps;
  - unpaid tolls, DMV suspensions, and delivery fees, only when the text has a link;
  - job and task scams: deposits to unlock tasks, commission per task, and high daily pay;
  - business email: new bank or remittance details, payroll changes, and urgent favors from a "boss";
  - sextortion threats;
  - marketplace scams: codes texted to your phone, "upgrade to a business account to receive Zelle", and
    overpayments;
  - fake account violation appeals (moderate, because real platforms send violation notices too);
  - fund recovery offers.
- Bitcoin ATMs, couriers, and gold purchases count as untraceable payment. "Sorry, wrong number" openers and "let's move
  to WhatsApp" are weak signs.
- **Device sign-in links.** Microsoft's device sign-in pages (`microsoft.com/devicelogin`, `microsoft.com/link`, and
  the OAuth device page) are a strong warning instead of an official link, because typing a code someone sent you there
  signs their device into your account.
- The AI step's label list has the 11 new families, written short so each call grows by about 225 tokens.
- Verified: 726 Vitest tests in 44 files and 19 Node tests pass. The labeled benchmark grew to 88 cases (47 scams, 41
  safe) with no misses or false alarms; the 19 new cases were written alongside the rules, so they show the rules work,
  not how they do on unseen messages. Twenty ordinary messages that use the same words (a real fraud alert handled by
  calling the card's number, paying a friend's toll, a viral video to share, a scam warning, TeamViewer for a
  grandparent, a real UPS tracking link) stay quiet.

## 2026-10-07: Fixes after the first live scans

- **Forged email from a domain with no SPF or DMARC.** A test email I sent with a forged sender, from a domain that has
  no SPF or DMARC records, came out No known threat. Google's sender check header listed only `spf=none`, and the
  reader looked only at that first header, so DKIM and DMARC counted as unknown. Now the top header (added by the
  receiving server) decides, a check it leaves out counts as none, and lower headers can only make a result worse, so a
  forged "pass" never helps. An email with no passing SPF, DKIM, or DMARC now gets "Nothing confirms who really sent
  this email", and the test email is Suspicious.
- **Discord answered "You are being rate limited" (429) to the first live lookup.** Cloudflare Workers share outgoing
  addresses, and Discord limits requests without a login per address. The invite lookup can now send an optional bot
  token (`DISCORD_BOT_TOKEN`), which Discord limits per bot instead. With the token set, a live scan of
  `discord.gg/minecraft` showed "Discord has verified this server".
- **Steam.** A clean account now shows "Steam shows no bans on this account" (with its age when the profile is public),
  so a working check is visible. A live scan of a real profile on 2026-10-07 reached Steam without errors.
- **abuse.ch.** URLhaus did not respond once in a live scan while ThreatFox, with the same key, did. URLhaus,
  ThreatFox, and MalwareBazaar failures now raise `urlhaus_unavailable`, `threatfox_unavailable`, or
  `malwarebazaar_unavailable` with the status or timeout, never the host, fingerprint, or key.
- Verified live after the release: the FCC number and the scam wallet were both caught, all nine lists are in D1
  (28,734 FCC numbers and 4,599 wallets), and `npm run check:live` passes, including the email file step.

## 2026-10-07: Discord and Steam checks, scam wallets, FCC numbers, email files, and more file types

- **Discord invites.** For a discord.gg or discord.com/invite link, the scanner asks Discord's public invite endpoint
  (no key) when the server was made, whether Discord verified it, and whether its name claims to be a company's staff
  or support. A server that claims to be support without being verified is a strong warning, a server made in the last
  30 days a weak one, and an invite that no longer works is noted. Invites no longer count as links to Discord's
  official website, because anyone can make a server. Server names are never shown or stored.
- **Steam accounts.** For a steamcommunity.com profile, custom profile name, or trade offer link, the scanner asks the
  Steam Web API about trade bans (strong), trade probation and community bans (moderate), game bans (background only),
  accounts made in the last 30 days when the profile is public (moderate), and names that claim to be staff. It needs
  `STEAM_WEB_API_KEY`; until I set it, reports list Steam as not connected.
- **Scam wallets.** Wallet addresses in a message (0x and 40 hex digits) are compared with a hashed copy of
  ScamSniffer's daily list of 4,599 scam wallets (`blacklist/all.json`; the older `address.json` stopped updating in
  2024). A match is a strong warning in the wallet drainer family.
- **FCC complaint numbers.** The daily sync now also downloads the caller ID and callback numbers from the last 90 days
  of the FCC's consumer complaints about unwanted calls (28,734 unique numbers on 2026-10-07). A match is a moderate
  warning, or a weak one when the FTC's list already matched, so two lists about the same kind of report do not add up
  to a scam verdict on their own.
- **Email files.** A saved .eml file can be added like any other file. The browser reads the sender's name, the
  subject, and the text (HTML links become link text plus address, so disguised links are caught), the receiving
  server's SPF, DKIM, and DMARC results, whether replies go to another domain, and the attachments, which are looked at
  with the same on-device file checks. Only the text, the sender's domain, those results, and each attachment's type
  and findings are sent. New warnings cover a failed sender check, a sender name that says Steam or Discord from
  another domain, a look-alike sender domain, a sender domain on a scam list, replies to another domain, and risky
  attachments.
- **More file types.** Browser extensions (.crx, .xpi, and extension zips) with the permissions they ask for, including
  reading login cookies; programs packed from Python with PyInstaller; .url, .search-ms, and .library-ms shortcuts that
  open files on another computer; .reg files that change startup or security settings, in either text encoding;
  .appinstaller files and MSIX packages; CHM help files by their contents; and Roblox models with backdoor tricks
  (`require` by asset ID, `loadstring`, `getfenv`).
- **Advice.** A high-risk message with no links now says not to reply, call any number in it, or send money, codes, or
  files, instead of "do not open the link". The callback scam advice now says to call the bank if card details were
  already given.
- Migration `0008` allows the two new lists. A scan in the scanner with 20 links, two Discord invites, and two Steam
  profiles uses 46 of the 50 subrequests (26 fetches, 6 Spamhaus lookups, 14 queries).
- Verified: 675 Vitest tests in 44 files and 19 Node tests pass, the browser privacy check reads a test email in Chrome
  and confirms no address, recipient, or attachment leaves the page, the accessibility audit passes with the email
  details box in both themes at both widths, and the restore drill matches every table with eight migrations. Discord's
  invite endpoint, ScamSniffer's file, and the FCC dataset were checked live from my computer; Steam is tested only
  with a fake server until the key is set.

## 2026-10-06: Phone number checks, callback scam rules, and the text box

- **Fake order and voicemail callback scams.** A text claiming a $999 Walmart laptop order, with "call us back or press
  1" and a "voicemail" number to tap, was rated No known threat: it had no links, and both numbers were hidden as
  codes. Three new rules now catch this family: a voicemail notice that sends you to a phone number, a claimed order or
  charge with an amount and a number to call, and a well-known company named next to a number to call. The family has
  its own advice: do not call the number, and check orders in the official app or website.
- **US phone numbers** without dashes are now labeled as phone numbers instead of codes. They stay hidden from the
  text, the AI step, and every outside service.
- **FTC Do Not Call reports.** The daily sync now also downloads the last 30 days of the FTC's reported-calls files
  (212,239 unique numbers) into a hashed list. Numbers from a message are compared inside ScamCam and never sent
  anywhere; a match is one moderate warning, since the FTC does not verify reports and callers can fake numbers. The
  callback number in the Walmart text had been reported to the FTC twice on 2026-09-21. Migration `0007` allows the
  new list.
- **Text box.** A small Clear text button empties the box and puts the cursor back in it. Pasting a screenshot over
  selected text now replaces the selection, the way pasting text does, instead of adding to it.
- Verified: 621 Vitest tests in 41 files and 18 Node tests pass, the browser privacy check pastes a screenshot over
  selected text and presses Clear text, the accessibility audit passes, and the restore drill matches every table with
  seven migrations.

## 2026-10-06: Spamhaus and PhishStats fixes after release

- **Spamhaus** never answered in production. The logs showed why: Cloudflare refuses Workers' TCP connections to outside
  DNS servers ("proxy request failed, cannot connect to the specified address"), even though the same code reached
  Spamhaus from a local copy of the runtime. Lookups now go over DNS over HTTPS through Cloudflare's own resolver, each
  question in a POST body so the key is never in an address. Spamhaus's free DQS terms set no rule on resolvers; the
  public-resolver block I had read about applies to the Spamhaus Project's public mirrors. The unused TCP code is gone.
- **PhishStats** timed out on shared-hosting links such as `pages.dev` sites, because their lookup used a "contains"
  search that took 5.4 seconds. It now uses a "starts with" search, which took 0.2 seconds for the same record.
- Spamhaus, PhishStats, and Cloudflare Radar failures now raise alerts with the reason or HTTP status and the
  provider's own message, never the domain or a key. Radar was confirmed working with a scan of `wikipedia.org`.
- Verified: 610 Vitest tests in 40 files and 17 Node tests pass, and live scans on the deployed site showed Spamhaus's
  listing of `dbltest.com` and PhishStats' report for a `pages.dev` phishing site, with no alerts in the logs.

## 2026-10-06: Result flags, five more scam lists, Spamhaus, PhishStats, Radar, and a license

- **Flag result as incorrect.** Every report now has a button to flag it for review, with four reasons and an optional
  note. Flags are for review only. The scan engine never reads them, and a config test fails if anything but the flag
  route and maintenance touches the table, so flagging a scam site over and over cannot make it look safe. A flag
  needs its own Turnstile check (the `flag` action), a report ScamCam signed in the last 24 hours, and fits within 3 a
  minute per visitor and 200 a day in total. One flag is kept per report. Notes lose emails, phone numbers, codes, and
  control characters. A flag keeps only the verdict, the finding IDs, the domain or file fingerprint, the reason, and
  the note, for 30 days. `npm run flags` lists them, and weekly maintenance raises `flags_waiting`.
- **Five more scam lists**, checked like Phishing.Database against hashed copies in D1: MetaMask's phishing list,
  ScamSniffer, PhishDestroy, DevSpen's public-domain Discord and Steam scam links, and CERT Polska's warning list. All
  six are looked up in two D1 queries. Each list has its own freshness rule (7 days, 3 for CERT Polska, and a year for
  DevSpen's rarely updated list). The daily workflow, now "Scam list sync", downloads each list at its latest commit
  and fails if any list fails.
- **Spamhaus DBL and ZRD** through the free Data Query Service, in the scanner only. Queries go over DNS on TCP
  straight to Spamhaus's own nameservers, so the key never passes through a public resolver, and query names are never
  logged. Phishing, malware, and botnet listings confirm a result; spam domains and abused real sites raise warnings;
  a domain first seen in the last 24 hours is a moderate warning unless the registry already shows it is new.
- **PhishStats** for the main link, in the scanner only, cached for 6 hours and capped at 140 calls a day.
- **Cloudflare Radar.** A domain in the top 100,000 that is not shared hosting loses only the often-abused-ending and
  brand-mismatch warnings, and the report credits Cloudflare Radar (CC BY-NC 4.0). A real listing still decides.
- **Check it yourself elsewhere.** Reports link to VirusTotal, Google's Safe Browsing site status, urlscan.io, Cisco
  Talos, ScamAdviser, and URLVoid for domains, and VirusTotal, Hybrid Analysis, and Cisco Talos for files. ScamCam
  sends them nothing.
- **License.** The code is now released under AGPL-3.0-or-later.
- Weekly maintenance also alerts when a list is missing (`scam_list_missing`) or has not been refreshed for 2 days
  (`scam_list_sync_late`), and the recovery drill now covers shared reports and flags.
- The list builder crashed on Windows while exiting with an error; it now sets the exit code instead.
- Verified: 609 Vitest tests in 39 files, 17 Node tests, the accessibility audit (60 checks, including the open flag
  form), the browser privacy check (now also scanning, flagging, and seeing the confirmation), and the recovery drill
  (9 tables). Local workerd reached Spamhaus's real servers over TCP with a placeholder key, and PhishStats' query
  syntax was checked live without a key.
- Released the same day: migration `0006` applied to production with the existing list kept, all six lists synced
  in 1 minute 23 seconds (02:49 UTC on 2026-10-07), and `npm run check:live` passed.

## 2026-10-06: File checks, ThreatFox, and list fixes

- **Check a file.** A new button (or paste, or drop) reads a file on the visitor's device without opening or running it.
  It finds the real type from the contents (Windows programs and libraries, installers, shortcuts, scripts, Android
  and Java apps, Mac and Linux programs, disk images, archives, Office documents, PDFs, web pages, SVG images) and
  looks for disguised names (`photo.jpg.exe`, padded names, text direction tricks), Office macros, PDF Launch actions
  and JavaScript, fake login pages and hidden downloads in web pages, code in SVG images, password-protected archives,
  and programs inside archives, which are listed without unpacking.
- Only the SHA-256 and SHA-1 fingerprints, size, type, extension, and fixed finding codes are sent (`POST
  /api/v1/files`), never the file or its name. The scanner looks the fingerprints up in MalwareBazaar (the existing
  abuse.ch key), CIRCL hashlookup, and Team Cymru's Malware Hash Registry through Cloudflare DNS. File reports show
  the fingerprint with a VirusTotal link the visitor opens themselves, because VirusTotal's terms forbid showing its
  results to others.
- **ThreatFox** (abuse.ch) now checks link domains for malware control servers and download sites, inside the scanner
  only.
- **List date.** The upstream Phishing.Database project has published nothing since 2026-10-02, yet the copy looked
  fresh because its age counted from ScamCam's sync. Age now counts from the upstream commit: reports name the date
  after a day, an alert fires after 2 days, and the list stops being used after 7.
- **Redirect services on lists.** Phishing.Database lists `l.instagram.com`, Instagram's own link redirect. Matches on
  redirect services now count only as context, and the real destination is checked.
- **abuse.ch links.** abuse.ch's website terms allow links to home pages only, so URLhaus, ThreatFox, and MalwareBazaar
  evidence now links to each home page.
- The browser privacy check no longer crashes when Chrome closes while a worker request is pending, and a new step
  drops a fake `Invoice 2026.pdf.exe` and confirms its name and contents never reach any server.
- Verified: 559 Vitest tests in 33 files, 14 Node tests, the accessibility audit, and the browser privacy check pass.
  Against the real services, the EICAR test file's fingerprints came back confirmed by Team Cymru (100% of engines)
  and CIRCL, and MalwareBazaar answered with no sample on record.

## 2026-10-06: Hidden link text and screenshot links

- Link text that shows one address but opens another, like Discord's `[rockstargames.com/gift](https://gta2026.net)`
  or Slack's `<real|shown>`, is rated high risk with the summary "This link pretends to go to rockstargames.com."
  Only the real address is checked.
- Links read from a screenshot no longer count as official, because a picture shows only a link's text. The report
  says so and explains how to copy the link itself. Links decoded from a QR code keep their credit.
- `gta2026.net` (8 days old, on hold at its registry, not resolving) had been rated no known threat. A domain under 90
  days old that is already on hold is now a moderate warning, two or more points of warnings make a result Unknown,
  and summaries no longer say "None of ScamCam's checks found a problem" next to a warning.
- Rockstar Games is a known brand, including names such as `gta2026`, and "free GTA 6 giveaway" offers count as free
  reward scams.
- Screenshots: the area of a decoded QR code is painted over before reading text, so its pattern no longer turns into
  stray letters; links wrapped onto two lines are joined; `https:/` is repaired. The AI's "QR code login takeover"
  guess is ignored when ScamCam decoded the QR code itself.
- An advisory published on 2026-10-06 for `sharp` 0.35.4 (pulled in by Cloudflare's local tooling, never shipped to
  the site) is fixed with an npm override to 0.35.5, so `npm audit` reports 0 vulnerabilities again.
- Verified: 517 Vitest tests in 30 files and 14 Node tests pass. The browser check now reads a generated QR code
  card, finds no stray text, scans it, and confirms it is not called a QR code scam.

## 2026-10-06: QR code fixes

- A screenshot of a harmless QR code, such as one for a LinkedIn profile, was rated Suspicious, because the
  `QR code: ` label that the screenshot reader adds made the "asks you to scan a QR code" rule fire. The label is now
  removed before the message rules run, and a screenshot that holds only a QR code is checked as a link.
- Discord and Steam login QR codes (`discord.com/ra/...`, `s.team/q/...`) are rated high risk as QR code login
  takeovers, even though the addresses are official.
- Live scans through the scanner used 7, 6, and 1 ms in the Worker and 22, 17, and 0 ms in the scanner, but each
  scan with lookups kept the scanner busy for about 5 seconds because timeout timers kept running. Every lookup now
  clears its timer when it finishes.
- Verified: 503 Vitest tests in 30 files pass.

## 2026-10-06: Scanner and newer checks

- Scans run in a SQLite-backed Durable Object named `Scanner`, which the Workers Free plan gives 30 seconds of CPU per
  request instead of a Worker's 10 ms. Live scans with links had used 16 to 26 ms. The Worker keeps the rate limit,
  Turnstile, and the signed answer, and runs the scan itself if the scanner is unreachable, with a
  `scanner_unavailable` alert.
- Redirect wrappers are decoded from the link itself (Steam's link filter, Google, Microsoft Safe Links, Proofpoint,
  Facebook, Instagram, YouTube, Reddit, LinkedIn, Slack, VK, Bing, Tumblr, href.li, and `?url=` style parameters), so
  the destination is checked and the wrapper no longer counts as an official link.
- Cloudflare's 1.1.1.2 security resolver is a new source: a host it blocks is rated high risk.
- New message rules: the copy-paste command trick ("ClickFix"), running commands, connecting a crypto wallet, and
  replying to make a link work. Two new scam families, `command_paste` and `wallet_drainer`, are known to the AI step.
- A message that names a brand but links to an unrelated site is flagged, and the five endings with the highest
  phishing rate in Interisle's Phishing Landscape 2025 add a small warning.
- The Worker fallback's shared cache budget dropped from 24 to 20 calls, so a 20-link scan uses 44 of 50 subrequests.
- Site name: "ScamCam - Check the Scan".
- Verified: 494 Vitest tests in 29 files and 14 Node tests pass, and local scans through the scanner flagged
  Cloudflare's blocked test hosts, a Steam link filter link to one of them, and a copy-paste command message.

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
