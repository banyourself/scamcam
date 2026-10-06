# ScamCam Contextual Threat Analysis (SCTA)

SCTA is ScamCam's experimental method for judging a whole interaction, not only a link. The first version was built in
Stage 3 (`src/engine`); every technique must keep earning its place on a benchmark.

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
| Adaptive source selection | Skip slow or exhausted sources based on budgets and value | Stage 4 |

## Verdict rules

- Confirmed malicious only when a trusted source lists the exact URL or domain now.
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

## As built in Stage 3

Code lives in `src/engine`, which has no Worker-specific code so the future browser extension and Discord app can
reuse it.

| File | Role |
|---|---|
| `url-analysis.ts` | Parses each link with the WHATWG URL parser, finds the registrable domain with the Public Suffix List (`tldts`), and produces domain signals |
| `brands.ts` | Official domains for Steam, Discord, Roblox, Minecraft, Microsoft, Epic, Riot, Twitch, Blizzard, PlayStation, and Nintendo; well-known community sites; shorteners; IP loggers; free hosts; user-upload hosts |
| `confusables.ts`, `punycode.ts` | Look-alike skeletons (Cyrillic, Greek, Armenian letters, digit swaps, rn, vv, cl), edit distance, script mixing, RFC 3492 punycode decoding |
| `message-rules.ts` | 18 rules in 10 scam families, with leetspeak folding and negated clauses ignored ("never share your password") |
| `safe-browsing.ts`, `protobuf.ts` | Safe Browsing v5 `hashes:search`: Google's canonicalization, host and path expressions, SHA-256, 4-byte prefixes, decoding Google's Protocol Buffers answer, local full-hash matching |
| `rdap.ts`, `dns.ts`, `urlhaus.ts` | Domain age and hold status, existence, and malware host lookups |
| `verdict.ts`, `scan.ts` | Scoring, verdict, confidence, summary, recommendations, and the report |

### Scoring

Each signal has a strength: weak 1, moderate 2, strong 4, critical 6. The score is the message score plus the highest
single link score, so pasting many links does not inflate it.

| Level | Rule |
|---|---|
| Confirmed malicious | URLhaus lists the exact link, or a non-shared host, as serving malware right now |
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
evaluation.** Stage 4 adds a held-out set built from real, public indicators (URLhaus and Phishing.Database entries
for positives, popular gaming and general domains for negatives) and tracks the false positive rate on it.

Local analysis takes about 0.8 ms per case in Node. Production CPU time on the Workers Free plan (10 ms limit per
request) must be measured after deployment with Workers observability.

## As built in Stage 4

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

### AI step

| Rule | Value |
|---|---|
| When | No message rule matched, no link has a strong or critical warning, the level is Unknown or No known threat, and at least 20 characters remain without links |
| Input | The redacted message with links replaced by `[link]`, at most 1,200 characters, between markers that are removed from the message itself |
| Model | `@cf/qwen/qwen3-30b-a3b-fp8`, temperature 0, at most 12 output tokens, thinking off, 5-second limit |
| Output | Exactly one label: one of the 10 scam families or `none`; anything else is ignored |
| Effect | A family adds one strong warning, so the result can reach Suspicious with low confidence, and the summary says only an AI check raised it. `none` changes nothing. The AI cannot lower a result |
| Limits | 2,000 calls a day, counted in D1 before each call; no call when the count cannot be written |

### Benchmark results (Stage 4)

The 69-case tuning benchmark still scores precision 1.000 and recall 1.000. The AI evaluation sets, written as
natural gamer messages, show what the rules miss: rules alone caught 6 of 30 and 3 of 20 scams, and rules with the AI
caught 24 of 30 and 16 of 20, with no false alarms on 50 normal messages. Full tables are in `BUILD_STATE.md`.

### Known limits

- Links that redirect (shorteners, official redirectors such as Steam's link filter) are not followed, by design.
- New scam domains with no look-alike name and no message context are "unknown" until a list or Safe Browsing knows them.
- Message rules are English only, and they miss most scams that are worded differently from their patterns; the AI
  step covers much of that gap.
- The AI step is a small model on hand-written evaluation sets. It can be wrong, and its label can be less precise
  than the scam it caught.
- The official domain lists are hand-maintained and must be reviewed when platforms add domains.
