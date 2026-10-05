# ScamCam Contextual Threat Analysis (SCTA)

SCTA is ScamCam's experimental method for judging a whole interaction, not only a link. This document is the design;
implementation starts in Stage 3 and every technique must earn its place on a benchmark.

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
