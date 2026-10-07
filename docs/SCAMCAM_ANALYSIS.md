# ScamCam Contextual Threat Analysis (SCTA)

SCTA is ScamCam's experimental method for judging a whole interaction, not only a link. The first version was built
with the detection engine (`src/engine`); every technique must keep earning its place on a benchmark.

## Questions SCTA answers

1. Who is contacting the user, and what identity or authority do they claim (Steam Support, a Discord moderator,
   a Roblox admin, a friend)?
2. What action is requested (log in, scan a QR code, install a file, send items, move to another platform)?
3. What is targeted (account credentials, session tokens, items, money, personal details)?
4. Is there urgency or a threat ("your account will be banned in 24 hours")?
5. Do the links match the claimed organization (domain, registrable domain, punycode, lookalikes)?
6. Does the interaction match a known scam pattern?
7. Do independent sources agree, disagree, or say nothing?
8. What evidence is missing or contradictory?

## Pipeline

| Stage | Work | Cost |
|---|---|---|
| 1. Deterministic | Extract links, parse with WHATWG URL, registrable domain via the Public Suffix List, punycode and mixed-script detection, confusable-character skeletons against a list of gaming brands, IP-literal and port checks, known-pattern rules | CPU only |
| 2. Evidence | Safe Browsing v5 hash prefixes, URLhaus and Phishing.Database local matches, RDAP domain age, DNS records, cached indicators | Few subrequests, cached |
| 3. Small AI model | Only if stages 1 and 2 are inconclusive and context matters: classify the narrative into a fixed set of scam types with a strict JSON schema | Workers AI Free neurons |
| 4. Fallback | If AI is unavailable or over budget, return the stage 1 and 2 assessment honestly with "unknown" where appropriate | None |

## Techniques to evaluate

Each one is kept only if it improves precision or recall on the benchmark without unreasonable cost.

| Technique | Idea | Initial status |
|---|---|---|
| Domain homograph detection | Map characters to Unicode confusable skeletons and compare with brand domains | Build first |
| Punycode analysis | Decode `xn--` labels and flag mixed scripts | Build first |
| Lookalike distance | Edit distance and keyboard-adjacency to brand names on the registrable domain only | Build first |
| Behavioral scam fingerprints | Rule sets per scam family: fake trade offer, "free Nitro", "I accidentally reported you", fake middleman, account recovery bait | Build first |
| Scam narrative classification | Fixed taxonomy of gaming scam narratives; rules first, AI only for inconclusive text | Evaluate |
| Contextual intent extraction | Pull the requested action and target asset out of the message | Evaluate |
| Evidence correlation | Combine signals with explicit weights and record why | Build first |
| Cross-source contradiction detection | Flag when sources disagree and lower confidence instead of picking one | Build first |
| Time-sensitive indicator scoring | Newer registrations and fresh listings weigh more; old listings decay | Evaluate |
| Near-duplicate recognition | Locality-sensitive hashes of normalized message templates to spot known scam scripts without storing messages | Evaluate |
| Privacy-preserving similarity | Compare keyed hashes or shingle sketches instead of raw text | Evaluate with near-duplicates |
| Explainable confidence | Every verdict lists the signals and their contribution | Build first |
| Scam-pattern clustering | Group similar indicators for maintenance, offline only | Later |
| Adaptive source selection | Skip slow or exhausted sources based on budgets and value | Built with caching |

## Verdict rules

- "Listed as malicious" (level `confirmed_malicious`) only when a trusted source lists the exact URL or domain now.
- A clean database result is never "safe". The lowest level is "No known threat detected" with an explanation.
- Contradictions lower confidence and are shown.
- Missing sources are shown as "not checked", not silently ignored.
- Safe Browsing findings use Google's required hedged wording and attribution.

## Normalization rules

Lowercase the scheme and host, decode punycode for display only, remove default ports, keep the path and query
for matching but never store them raw. Do not strip subdomains, paths, or parameters when that would merge two
different indicators (for example `steamcommunity.com.evil.example` must not become `steamcommunity.com`).

## Benchmark

- Labeled set: public phishing indicators (URLhaus, Phishing.Database) for positives; top legitimate gaming domains
  and their real login and trade URLs for negatives; hand-written gaming scam messages and real benign messages
  written for the test set (no real private messages).
- Metrics: precision, recall, false-positive rate, false-negative rate, median and p95 latency, provider calls per
  scan, storage growth, evidence quality (share of verdicts with at least two independent signals), and cost.
- Targets are set after the first run and recorded here. False positives on legitimate gaming domains must be 0.

## Detection engine as built

Code lives in `src/engine`, which has no Worker-specific code so the future browser extension and Discord app can
reuse it.

| File | Role |
|---|---|
| `url-analysis.ts` | Parses each link with the WHATWG URL parser, finds the registrable domain with the Public Suffix List (`tldts`), and produces domain signals |
| `brands.ts` | Official domains for Steam, Discord, Roblox, Minecraft, Microsoft, Epic, Riot, Twitch, Blizzard, PlayStation, and Nintendo; well-known community sites; shorteners; IP loggers; free hosts; user-upload hosts |
| `confusables.ts`, `punycode.ts` | Look-alike skeletons (Cyrillic, Greek, Armenian letters, digit swaps, rn, vv, cl), edit distance, script mixing, RFC 3492 punycode decoding |
| `message-rules.ts` | 48 rules in 24 scam families, with leetspeak folding and negated clauses ignored ("never share your password"). Families cover gaming scams and the costliest scams in general: investment, bank and government impersonation, tech support, tolls and deliveries, jobs, business email, sextortion, marketplaces, account appeals, and fund recovery. Toll, DMV, delivery, and appeal rules fire only when the message has a link |
| `safe-browsing.ts`, `protobuf.ts` | Safe Browsing v5 `hashes:search`: Google's canonicalization, host and path expressions, SHA-256, 4-byte prefixes, decoding Google's Protocol Buffers answer, local full-hash matching |
| `rdap.ts`, `dns.ts`, `urlhaus.ts` | Domain age and hold status, existence, and malware host lookups |
| `verdict.ts`, `scan.ts` | Scoring, verdict, confidence, summary, recommendations, and the report |

### Scoring

Each signal has a strength: weak 1, moderate 2, strong 4, critical 6. The score is the message score plus the highest
single link score, so pasting many links does not inflate it.

| Level | Rule |
|---|---|
| Listed as malicious | URLhaus lists the exact link, or a non-shared host, as serving malware right now |
| High risk | A Google Safe Browsing match, or a score of 6 or more |
| Suspicious | A score of 3 or more |
| No known threat detected | Score of 2 or less and either every link is official, Safe Browsing checked the other links with no match, or there were no links and no scam patterns |
| Unknown | Everything else, for example an ordinary domain when Safe Browsing is not connected |

A Safe Browsing match alone is never "confirmed", because Google's terms require hedged wording. Confidence rises
when signals come from two or more independent sources and drops one step when an official domain and a strong
warning disagree (the report then shows "Sources disagree").

### Benchmark results (2026-10-05)

`test/client/benchmark.test.ts` runs 69 labeled cases (36 scams, 33 safe) with every outside source switched off, so
it measures the built-in rules alone.

| Run | Precision | Recall | False positives | False negatives |
|---|---|---|---|---|
| First run | 1.000 | 0.944 | 0 | 2 (the @ trick was hidden by email redaction; raw IP links were not extracted) |
| After fixing link extraction | 1.000 | 1.000 | 0 | 0 |

Before the first run, the scoring was adjusted on these same kinds of cases (user-upload hosts, gift card payments,
vote scams, hand-over-items, the cl look-alike, negated safety advice). **This set is a tuning set, not an independent
evaluation.** The held-out set from real, public indicators below (Phishing.Database entries for positives, 178
legitimate sites for negatives) tracks the false positive rate on data the rules were not tuned on.

Local analysis takes about 0.8 ms per case in Node. Production CPU time on the Workers Free plan (10 ms limit per
request) is tracked in `STATUS.md`.

## Caching, Phishing.Database, and the AI step as built

### Caching and deduplication

| Source | Cached under | Kept for | Notes |
|---|---|---|---|
| Google Safe Browsing | Each 4-byte hash prefix | Google's `cacheDuration` (usually 300 seconds), at most a day | Prefixes with no match are cached too, as the v5 reference requires; only uncached prefixes are sent; a warning is never shown from an expired entry |
| URLhaus | Hostname hash | 15 minutes | Failures are not cached |
| RDAP | Registrable domain hash | 24 hours, or 1 hour for a missing domain | A 429 pauses that registry for its `Retry-After` (otherwise 5 minutes) |
| DNS | Hostname hash | The answer's TTL, 60 to 3,600 seconds; missing names 60 to 900 | |
| RDAP bootstrap | Fixed key | 12 hours, plus a copy in memory | |
| AI answers | SHA-256 of the cleaned message | 1 hour, in the Worker's memory only | Never written to a shared cache |

Identical lookups running at the same time share one request. A source that fails three times in a row is skipped
for a minute and reported as "did not respond".

### Phishing.Database

Each list entry is lowercased and checked as a hostname, then reduced to the first 8 bytes of its SHA-256 hash. Keys
are sorted into 1,024 shards by their first 10 bits and stored as one D1 row each. A link is checked by its hostname
and each parent down to the registrable domain, so `login.evil.example` matches a listed `evil.example`, but
`b.shared.example` does not match a listed `a.shared.example`. A match is a strong warning (4 points) with wording that
says the list can be wrong. A match on a shortener, free-hosting suffix, user-upload host, or official domain is only
context. Official links are never looked up. With about 500,000 entries, the chance that an unlisted name collides
with a listed key is about 3 in 100 trillion.

At full size (2026-10-05, commit `12a20bf`), 392,179 lines gave 392,063 unique keys in 1,024 shards (the largest
3.5 KB) and 6.6 MB of SQL with the longest statement at 7,366 characters, built in about 3 seconds and loaded into a
local D1 in about 3 seconds. Entries include IPv4 addresses (5,466) and host names with underscores (521), and only
100 junk lines are refused.

### AI step

| Rule | Value |
|---|---|
| When | No message rule matched, no link has a strong or critical warning, the level is Unknown or No known threat, and at least 20 characters remain without links |
| Input | The redacted message with links replaced by `[link]`, at most 1,200 characters, between markers that are removed from the message itself |
| Model | `@cf/qwen/qwen3-30b-a3b-fp8`, temperature 0, at most 12 output tokens, thinking off, 5-second limit |
| Output | Exactly one label: one of the 24 scam families or `none`; anything else is ignored |
| Effect | A family adds one strong warning, so the result can reach Suspicious with low confidence, and the summary says only an AI check raised it. `none` changes nothing. The AI cannot lower a result |
| Limits | 2,000 calls a day, counted in D1 before each call; no call when the count cannot be written |

### Benchmark results (October 2026)

The 69-case tuning benchmark still scores precision 1.000 and recall 1.000, at about 1.1 ms per case. The AI
evaluation sets, written as natural gamer messages, show what the rules miss: rules alone caught 6 of 30 and 3 of 20
scams, and rules with the AI caught 24 of 30 and 16 of 20, with no false alarms on 50 normal messages.

With every outside source answering, a first scan makes 2.75 outside calls on average and 5 at most, and a repeated
scan makes none. The engine takes 1.25 ms per scan at the median and 3.12 ms at p95 for a first scan in Node, and
0.79 ms and 2.01 ms for a repeat.

#### AI evaluation (live Workers AI through the local dev server, 2026-10-05)

The messages were written for the test, modeled on scam types that Steam, Discord, and Roblox describe publicly; none
come from real people. The holdout set was written before any tuning and run once, with the final settings.

| Set | Model and prompt | Rules only: scams caught, false alarms | Rules and AI: scams caught, false alarms | Latency p50 / p95 | Neurons per AI call |
|---|---|---|---|---|---|
| Tuning (30 scams, 30 normal) | Granite 4.0 Micro, first prompt | 6 of 30, 1 of 30 | 19 of 30, 4 of 30 | 449 / 1,268 ms | 0.52 |
| Tuning | Granite 4.0 Micro, second prompt and vote rule fix | 6 of 30, 0 of 30 | 21 of 30, 2 of 30 | 403 / 1,013 ms | 0.52 |
| Tuning | Qwen3 30B A3B, second prompt | 6 of 30, 0 of 30 | 24 of 30, 0 of 30 | 303 / 497 ms | 2.11 |
| Holdout (20 scams, 20 normal) | Qwen3 30B A3B, final | 3 of 20, 0 of 20 | 16 of 20, 0 of 20 | 309 / 519 ms | 2.14 |

Latency is the whole scan through the local server, including Turnstile and the AI call. These runs used 189 AI calls
and about 242 neurons. The live prompt injection sets are in `OWASP_LLM_TOP_10.md`.

### Held-out benchmark from real indicators

Sampled from Phishing.Database (commit `12a20bf`, seed 20261005) and run once with outside sources off: the rules
flagged 71 of 200 gaming-impersonation domains (recall 0.355), 2 of 200 random phishing domains (recall 0.010), and
0 of 178 legitimate sites. The 129 missed gaming domains came back "Unknown", never "No known threat". The labels
are the list's, which has known false positives, so recall here means agreement with the list. Gaps found: brand
names as subdomains of unrelated sites, brand plus gift words on cheap endings, and brand words on free blog hosting.

Those gaps were closed on 2026-10-07 using this sample, which makes it a tuning set (127 of 200 gaming domains are now
flagged). A fresh sample from the same commit (seed 20261007, excluding every domain in the first, gaming domains
picked by the same kind of game-word match) is the new held-out set, run once before and after the change: 53 and then
94 of 200 gaming-impersonation domains flagged (recall 0.265 and 0.470), 0 of 200 random phishing domains both times,
and 0 of 178 legitimate sites both times.

### Hidden characters and checker instructions

Invisible characters are removed before any check. Inside a link or as a direction trick they raise a strong warning,
inside words or as hidden data a moderate one. Text aimed at scam filters or AI checkers raises a strong warning and
skips the AI.

### Known limits

- Links are never followed over the network, by design. Short links stay hidden. Redirect wrappers that carry their
  destination inside the link (Steam's link filter, Google, Safe Links, Proofpoint, and others) are decoded and checked.
- New scam domains with no look-alike name and no message context are "unknown" until a list or Safe Browsing knows them.
- Message rules are English only, and they miss most scams that are worded differently from their patterns; the AI
  step covers much of that gap.
- The AI step is a small model on hand-written evaluation sets. It can be wrong, and its label can be less precise
  than the scam it caught.
- The official domain lists are hand-maintained and must be reviewed when platforms add domains.

## Checks added on 2026-10-06

| Check | Signal | Why |
|---|---|---|
| Redirect wrappers decoded (`src/engine/redirects.ts`) | The wrapper loses any "official" credit and shows where it leads; the destination gets every link check and source | Phishing links hide behind trusted redirectors, and Steam's own link filter would otherwise have counted as an official Steam link |
| Cloudflare's 1.1.1.2 security filter | Critical warning (high risk on its own, not a confirmation) | A second independent threat list next to Google Safe Browsing, free and passive |
| Copy-paste command ("ClickFix") rule | Strong warning, new family `command_paste` | Fake "verify you are human" steps that make people press Windows+R and paste a command; Microsoft's Digital Defense Report 2025 names this the most common way in, and Check Point found it in hijacked Discord invites in 2025 |
| Running a command | Moderate warning | Pasting into PowerShell, a terminal, or the Run box, or PowerShell download-and-run commands |
| Crypto wallet connection | Strong warning, new family `wallet_drainer` | Fake airdrops, mints, and wallet verification pages drain connected wallets; "steam wallet" is excluded |
| Reply to activate a link | Strong warning | Scam texts ask for a "Y" reply so the phone turns links back on |
| Message names a brand, link goes elsewhere | Weak warning, moderate when a scam family also matched | A message about Steam or Discord whose link belongs to neither, and does not imitate them by name |
| Endings abused far more than most | Weak warning, linked to Interisle's Phishing Landscape 2025 | The 20 endings with the highest phishing rate for their size, from .xin and .bond to .best and .buzz (2026-10-07; the first five until then) |
| Login QR codes | Critical warning in the QR code login takeover family, and no "official" credit | A Discord (`discord.com/ra/...`) or Steam (`s.team/q/...`) login QR code logs in whoever made it, so sharing one is the takeover itself |
| Link text that hides the real address | Critical warning, and the summary names the site it pretends to be | Discord's `[shown](real)` and Slack's `<real\|shown>` formats; only flagged when the shown text is a different domain from the real one, and only the real address is checked |
| Links read from screenshots | No "official" credit, a note on each official-looking link, and advice to copy the link itself | A screenshot shows only a link's text, so `rockstargames.com/gift` in a picture may open anything. Links decoded from a QR code in the screenshot are real and keep their credit |
| A new domain already on hold | Moderate warning when the domain is under 90 days old (weak when older) | Registries and registrars suspend new domains after abuse reports or failed owner checks; `gta2026.net`, 8 days old and on hold, had been rated no known threat |
| Small warnings no longer read as "no problem" | Two or more points of warnings make the result Unknown, and summaries mention any minor warning | The report said "None of ScamCam's checks found a problem" next to two warnings |
| Rockstar Games | Brand with `rockstargames.com` and GTA tokens, including names such as `gta2026` | Free GTA 6 giveaways and early access offers are a common lure ahead of the game's release |
| AI and decoded QR codes | An AI "QR code login takeover" label is ignored when ScamCam decoded the QR code itself | The decoded link is checked directly, and login QR codes are caught by their address |
| QR codes read from screenshots | The `QR code: ` label that the screenshot reader adds is removed before the message rules run | The label alone made the "asks you to scan a QR code" rule fire on harmless QR codes, such as one for a LinkedIn profile |

Screenshot reading also improved: the area of a decoded QR code is painted over before the text is read, so its
pattern no longer comes out as stray letters, links that a chat app wrapped onto two lines are joined back together,
and a misread `https:/` is repaired.

Each rule has tests that it fires and tests that ordinary messages stay quiet, such as asking a friend to press
Windows+R and type `dxdiag`, an event invite that asks for a "yes", a Steam wallet balance, and an email's "paste this
link into your browser". The AI step knows both new families.

## File checks (2026-10-06)

The browser decides what a file really is from its first bytes and structure, not its name: Windows programs and code
libraries (PE headers, including whether a signature block is present), installers, shortcuts, scripts, Android
apps, Java programs, Mac and Linux programs, disk images, archives, Office documents, PDFs, web pages, SVG images, and
ordinary images. The server turns that into evidence:

| Finding | Strength | Why |
|---|---|---|
| A program, script, shortcut, or installer | Strong (moderate for code libraries, Android and Java apps, Mac and Linux programs, disk images, and saved web pages) | Running files from chats is how most gaming accounts are stolen |
| Program disguised as a document or picture (`invoice.pdf` that is really a program) | Critical | The file lies about what it is |
| Double endings (`photo.jpg.exe`), endings pushed out of view with spaces, text direction tricks in the name | Strong | Classic ways to hide that a file runs code |
| Office macros, a PDF Launch action, a login form or hidden download in a web page, code in an SVG | Strong | Common malware and phishing attachments |
| JavaScript or an embedded file in a PDF, a password-protected archive | Moderate | Used to hide content from scanners |
| A shortcut that starts PowerShell or the command prompt, a script that downloads and runs code | Critical | The usual first stage of malware |
| A program, script, or disguised name inside an archive | Strong | Archives are read without unpacking them |
| A Minecraft mod or plugin, a signed program, an archive that cannot be read | Context only | Advice, never a verdict on its own |

Fingerprints are then looked up:

| Source | Fingerprint | Result |
|---|---|---|
| MalwareBazaar (abuse.ch), with the existing abuse.ch Auth-Key | SHA-256 | A match confirms malware and names the family. Evidence links to the MalwareBazaar home page, because abuse.ch's website terms do not allow deep links |
| CIRCL hashlookup | SHA-256 | A file it tags as known malware is confirmed; a file it trusts (trust score 50 or more) from NIST's NSRL and other software collections counts as found in a library of known software, a moderate point in its favor, never proof (those libraries also hold security tools) |
| Team Cymru Malware Hash Registry, through Cloudflare DNS | SHA-1 (shorter than a DNS label; Team Cymru also accepts a SHA-256 split into two labels) | 25% or more of antivirus engines confirms malware; fewer is a strong warning |

A file over 100 MB is not fingerprinted, and the report says the lists could not be checked. A file with no
warning signs that no list knows is "No known threat detected" with medium confidence, because new malware is not in
any list yet. A file found in CIRCL's library of known software is also medium confidence, since CIRCL warns that a
match alone does not show a file is harmless.

VirusTotal is deliberately not used: its current terms (Google SecOps Service Specific Terms, section 3) forbid
making results accessible to anyone else and naming the antivirus engines in public, which rules out showing them to
visitors. Hybrid Analysis, OPSWAT MetaDefender, Kaspersky OpenTIP, and MalShare were also rejected on their terms.

Checked against real services on 2026-10-06: the EICAR antivirus test file came back as confirmed malware from Team
Cymru (100% of engines) and CIRCL (tagged by malshare.com), and MalwareBazaar answered that it has no sample on record.

## Minecraft mods and modpacks (2026-10-07)

Fake and infected mods are a main way Minecraft accounts and Discord logins are stolen: fractureiser got into real
uploads in 2023, Check Point described fake cheat mods spread from starred GitHub projects in 2025, and McAfee counted
more than 3,820 different WeedHack mod files in 2026. Hash lists only know files someone already reported, so the
browser also reads the text in a mod's class files (constants, text hidden in base64, and text built from byte or char
arrays) and the jars bundled inside it:

| Finding | Strength | Why |
|---|---|---|
| The folders where Discord, browsers, Telegram, or wallets keep logins | Critical | Mods have no reason to look there |
| A Discord webhook or Telegram bot address, plain with its token or hidden in encoded text | Strong | Where stolen data is sent |
| A URL class loader with a hidden address, or with the four-part URL constructor fractureiser used | Strong | Downloads and runs code |
| Two or more security tools (Wireshark, HTTP Debugger, Process Hacker, VirtualBox tools), or one with `tasklist` | Strong | Hiding from researchers |
| A process call with a Defender exclusion, a startup registry key, `schtasks /create`, `mshta`, `attrib +h`, or a download cradle | Strong | Hidden Windows commands |
| The Minecraft login token (1.8.9 Forge names, Fabric's `class_320` members, or Mojang's `User` getters) read in a class, plus a network call | Moderate | What session stealers take, but some account tools need it |
| Launcher account files (official launcher, Lunar, Prism, and others) | Moderate | The same |
| A hidden address that is not an official Minecraft host, or a link to a bare public IP address | Moderate | How malware fetches its next part |
| A Windows program or script inside the mod | Moderate | Can be started by the mod's code |

The moderate findings are capabilities honest account tools also have, so together they count only once and on
their own can make a file Suspicious but not High risk. The browser also reads the mod ID from `fabric.mod.json`,
`quilt.mod.json`, `neoforge.mods.toml`, `mods.toml`, `mcmod.info`, or a plugin's `plugin.yml`.

Then Modrinth is asked by SHA-1. If it publishes the exact file, the report names the project, the version, and its
release date as context. The listing only earns credit when the release has been public for at least two weeks, the
project has passed Modrinth's review, and nothing malware-only was found; then the moderate findings above and "This is
a Java program" become context, and a file with nothing else against it reads "No known threat detected" with medium
confidence. The two-week rule is for hacked developer accounts: an attacker who takes over an account uploads malware
as a new release, as fractureiser did, and it can stay up for days. If Modrinth does not have the file, and the mod ID
is a Modrinth project with at least 50,000 downloads, the report says the file claims to be that mod but is not one of
its releases, a moderate warning, since it could also be an official build from another site. A release Modrinth
removes turns into that warning within an hour, and a file reported to a malware list is confirmed malicious
whatever Modrinth says.

Modpacks: a `.mrpack` index that downloads from anywhere but Modrinth, GitHub, raw GitHub, and GitLab, or that places
files outside the game folder, is a strong warning. Mods carried inside a pack, in Modrinth or CurseForge format, are
fingerprinted and read like any mod, and they and the pack's downloads from outside Modrinth's own servers are
checked against Modrinth in one request.

Checked on 2026-10-07 against 61 real files downloaded from Modrinth: none flagged, and five login-token tools (Auth
Me, Entity Texture Features, Essential, Not Enough Updates, World Host) would be Suspicious if Modrinth did not have
the file. CurseForge has a fingerprint API too, but it needs a key that Overwolf approves by hand.
