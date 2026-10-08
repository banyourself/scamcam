# Architecture

## Overview

```
Browser ──HTTPS──> Cloudflare edge ──> one Worker "scamcam"
                                         ├── static assets (React SPA, _headers, security.txt)  free, unlimited
                                         └── /api/*  Hono app (Zod, OpenAPI)
                                               ├── D1 "scamcam"     operational data and the hashed Phishing.Database copy
                                               ├── Rate limiting bindings (API and scans)
                                               ├── Worker memory, then named cache "scamcam-lookups"  provider answers under hashed keys
                                               ├── Workers AI (Qwen3 30B A3B)     only for messages the rules cannot decide
                                               └── POST /api/v1/scans -> Turnstile in the Worker, then the
                                                   "Scanner" Durable Object runs src/engine: passive lookups only
                                                   (Safe Browsing hash prefixes, URLhaus host, RDAP domain,
                                                   DNS and 1.1.1.2 security DNS hostname)
Cron triggers ──> same Worker scheduled() ──> daily cleanup, weekly maintenance
GitHub Actions (daily) ──> Phishing.Database list ──> scripts/domain-list.ts ──> D1 shards
```

Only paths under `/api/*` invoke the Worker (`run_worker_first`). Everything else is served as a static asset, which
Cloudflare does not count against the Workers request quota.

### Free plan limits per request

On the Workers Free plan each request gets 10 ms of CPU time and 50 subrequests, and outside fetches, D1 queries, and
Cache API calls all count toward the 50. Live scans with links used 16 to 26 ms, so scans run in the `Scanner`
Durable Object (`src/worker/scanner.ts`), which gets 30 seconds of CPU per request on the Free plan. The Worker
checks the rate limit and Turnstile, calls the scanner over RPC, and returns the signed report. The scanner keeps one
named instance near the database (`wnam`), so its memory cache of provider answers stays warm across scans, and it
stores nothing. If the scanner call fails, the Worker logs a `scanner_unavailable` alert and runs the scan itself, so
the limits below still hold for that fallback:

- The worst crafted inputs take under 1 ms of analysis, because parsing time grows in step with input length.
- Outside lookups are capped (one Safe Browsing request, and at most 3 hosts each for DNS, RDAP, and URLhaus), Safe
  Browsing answers are kept per hash prefix in the Worker's memory, other answers are checked in memory before the
  shared cache, and a request may make at most 20 shared cache calls. A message with 20 links uses 39 subrequests
  in the Worker fallback (12 fetches, 20 cache calls, 7 queries) and 29 in the scanner with every source on, which
  uses memory only; a
  repeated scan in the same instance makes no outside calls.
- The daily cleanup shares one budget of 25 delete batches across all tables, so a run stays under 35 queries.

## Repository layout

| Path | Contents |
|---|---|
| `src/client` | React app: `App.tsx`, `router.tsx`, `pages`, `components` (`layout`, `scan`, `report`, `ui`), `hooks`, `lib` |
| `src/shared` | Types, labels, link extraction and redaction (`extract.ts`) shared by the site and the API; Zod schemas in `*-schema.ts` and `api.ts` so the site never bundles Zod |
| `src/engine` | The analysis engine with no Worker-specific code: URL and message analysis, Safe Browsing, RDAP, DNS, URLhaus, the lookup cache, Phishing.Database matching, the AI step, verdicts (see `SCAMCAM_ANALYSIS.md`) |
| `src/worker` | Worker entry (`index.ts`), Hono app (`app.ts`), `routes` (health, scans), `middleware`, `security`, `repositories`, `maintenance` |
| `migrations` | Versioned D1 schema |
| `public` | `_headers`, `.well-known/security.txt`, `robots.txt`, icon |
| `test/worker`, `test/engine` | Tests that run inside workerd with a real local D1 and a fake network |
| `test/client` | Site logic and server-rendered component tests |
| `test/node` | Configuration checks (cron parity, security.txt expiry, CSP, no em dashes) |
| `scripts/a11y.ts` | axe-core WCAG 2.2 AA audit in headless Chrome |
| `scripts/domain-list.ts` | Builds the hashed Phishing.Database shards and the SQL that loads them |
| `scripts/ai-eval.ts` | Live AI evaluation through a local dev server (`test/fixtures` holds the messages) |
| `docs` | This documentation |

## Technology decisions

| Choice | Why | Alternatives considered |
|---|---|---|
| One Worker with static assets instead of Pages | Cloudflare now tells new projects to start on Workers; static requests are free and unlimited; one deployable unit; same limits as Pages Functions | Pages + Functions (older path, two configs) |
| `@cloudflare/vite-plugin` | Official; runs the Worker in workerd during `vite dev` with local D1 | Separate `wrangler dev` and Vite servers |
| Hono + `@hono/zod-openapi` | Small router with typed validation and an OpenAPI document generated from the same Zod schemas | Hand-written router (more code), itty-router (no OpenAPI) |
| Zod 4 | Validation at every boundary, including third-party API responses | Valibot (smaller, but would duplicate the schemas used for OpenAPI) |
| D1 | Free, SQL, migrations, 7-day Time Travel. Repositories isolate SQL so PostgreSQL stays possible | KV only (no queries), external Postgres (cost, another vendor) |
| Workers rate limiting binding | No storage writes per request, no cost found in the docs | D1 counters (a write per request), WAF rule (Free plan allows one IP rule) |
| `tldts` for the Public Suffix List | MIT, maintained, fast, includes private suffixes such as pages.dev | `psl` (slower releases), a hand-made suffix list (wrong for multi-part endings) |
| Named Cache API cache for provider answers, behind the Worker's memory | Free, no write quota, expiry through `Cache-Control`, kept apart from the site's page cache; keys are hashes on the site's own origin. Memory comes first because every Cache API call counts toward the 50 subrequests a request may make on the Free plan, so Safe Browsing's many per-prefix answers stay in memory only | KV (1,000 writes a day on Free), D1 (a write per lookup) |
| Hashed Phishing.Database shards in D1, built by GitHub Actions | A daily sync writes about 1,025 rows and a check reads one; the 11 MB list is far too much for a Worker's 10 ms of CPU on Free | One row per domain (about 500,000 writes per refresh), KV, static assets (stale between deploys) |
| Workers AI with Qwen3 30B A3B for unclear messages | Free allocation, Apache 2.0, caught 80 percent of scams in the evaluation sets with no false alarms, about 2.1 neurons a call | Granite 4.0 Micro (cheaper, more false alarms), larger models (5 to 10 times the neurons) |
| Remote bindings off in tests and CI | Tests use a fake model and CI has no Cloudflare login; the local dev server still reaches the real model | Running CI against a real account |
| Own Protocol Buffers reader for Safe Browsing answers | Safe Browsing v5 answers only in binary Protocol Buffers. The reader is about 60 lines, rejects malformed input, and was checked against Google's live answers | `protobufjs` (a large dependency for three small messages) |
| Own punycode decoder and Safe Browsing canonicalizer | Small, tested against RFC 3492 vectors and Google's published examples, no `nodejs_compat` needed | `punycode` package or Node compatibility mode |
| File checks on the visitor's device, by fingerprint only | The browser reads the file (bounded reads: 64 KB head, the zip directory up to 4 MB, at most 20 MB scanned, 100 MB hashed) and sends the SHA-256 and SHA-1 fingerprints, size, detected type, extension, and fixed finding codes. The server owns every word of the report, so a caller can only choose codes, not text. No file, name, or content reaches the server, and nothing is opened or run | Uploading files to the Worker (privacy, storage, and executing untrusted input near the backend), or to a sandbox service (shares the file with a third party) |
| Minecraft mods read on the device, then compared with Modrinth | Account stealers spread as mods, and the text in a jar's class files gives them away. The browser reads a copy of at most 64 MB in memory (up to 12,000 class files, jars inside jars one level deep), including text hidden in base64 or byte arrays, and only the SHA-1 and the mod ID go to Modrinth, which needs no key | Uploading mods to a sandbox service; CurseForge's API (needs a key approved by hand) |
| ThreatFox only inside the scanner | ThreatFox adds up to 3 lookups per scan. The scanner has room for them; the Worker fallback, which uses up to 39 of the 50 subrequests, skips them | Calling it everywhere and lowering other caps |
| Discord and Steam only inside the scanner, read from the link's address | The invite code or profile name is in the link itself, so asking Discord's and Steam's own APIs never opens the submitted link. At most 2 of each per scan, Steam batched, answers kept an hour in memory | Opening invite or profile pages (visits submitted links), scraping (against both sites' terms) |
| GitHub facts only inside the scanner, one link per scan | The owner and repository are in the link itself, so GitHub's REST API answers without opening the link; the repository and its owner are asked in parallel (2 calls), which keeps the scanner's worst case at 38 of 50. A token with no permissions lifts the limit from 60 an hour per shared address to 5,000 an hour | Scraping github.com pages (opens submitted addresses, against GitHub's terms), GraphQL (one call, but blocked repositories are not reported as clearly as the REST 451) |
| Email files read on the device | The browser parses the .eml and sends only the text a visitor could paste plus fixed facts (sender domain, SPF, DKIM, DMARC, reply-to flag, attachment types and findings), so addresses and attachments never reach the server | Uploading the email (addresses, recipients, and attachments would reach the backend) |
| A SQLite-backed Durable Object for the scan engine | The Free plan gives Durable Objects 30 seconds of CPU per request instead of a Worker's 10 ms, 100,000 requests and 13,000 GB-s a day, and stays on Cloudflare with the same bindings and no new secrets. One named instance keeps its memory cache warm; the Worker falls back to scanning itself | Workers Paid ($5 a month), a second host such as a free VM (another vendor, secrets in two places, one machine to keep alive) |
| Password checks by k-anonymity through ScamCam | The browser hashes the password with SHA-1 and sends 5 characters; the Worker asks Pwned Passwords, so the content security policy keeps `connect-src 'self'` and Have I Been Pwned never sees the visitor's address | Calling api.pwnedpasswords.com from the browser (a new origin in the policy and the visitor's address shared); sending the password or the full hash anywhere |
| The breach list searched in the browser, built by the scanner | Have I Been Pwned's 1.1 MB list is fetched and compacted to 191 KB in the scanner (30 seconds of CPU) and kept in its storage, the edge, and the Worker's memory. The browser downloads it once and searches it, so search words never reach the server, and link reports read the scanner's stored copy without a new fetch | Searching on the server (search words in requests), parsing the list in the Worker (close to its 10 ms), a D1 table (a migration and a sync job for a list that changes a few times a week) |
| One DNS lookup per host, through 1.1.1.2 | The security resolver answers normally for names it does not block, so one lookup gives both the block and whether the site exists; it saves up to 3 subrequests per scan | A separate 1.1.1.1 lookup per host |
| Budget counts batched per moment | Calls that arrive together are counted in one D1 query, still exactly, which cut queries per scan from 14 to 6 in the scanner | Reserving budget in blocks (overcounts and shrinks the daily budgets) |
| Cloudflare's 1.1.1.2 security resolver as a source | Free, DNS over HTTPS like the existing lookup, answers `0.0.0.0` with an extended DNS error for blocked malware and phishing hosts, receives only the hostname | Quad9 (its JSON service was retired in 2025 and its DNS over HTTPS needs HTTP/2) |
| Decoding redirect wrappers offline | Steam's link filter, Google, Microsoft Safe Links, Proofpoint, Facebook, YouTube, Bing, and generic `?url=` style parameters are read from the link itself, so the real destination is checked without opening anything | Following redirects over the network (forbidden: ScamCam never opens submitted links) |
| Turnstile | Free, privacy-focused, no cookie banner needed when used for security | reCAPTCHA (tracking concerns), hCaptcha |
| Tailwind CSS 4 + shadcn-style components | Utility CSS with no runtime, accessible primitives copied into the repo rather than a component dependency | A component library dependency |
| `@cloudflare/vitest-plugin` | Official replacement for `vitest-pool-workers`; tests run in the real runtime with D1 | Mocked bindings (misses runtime behavior) |
| TypeScript 7 | Current stable compiler; strict settings | TypeScript 5.x |
| Vitest 4, held at the major version | `@cloudflare/vitest-plugin` 1.3.6 supports only `vitest` `^4.1.0`; Dependabot ignores Vitest major updates until the plugin supports the next one, then both move together | Vitest 5 (`npm ci` fails with a peer dependency conflict) |
| `@types/node` 24 | Matches Node 24, the minimum version and the one CI and the dev container use, so code cannot rely on newer Node APIs by accident; Dependabot ignores its major updates | Newer `@types/node` majors |
| No Docker, Redis, VMs, Python, Go, or microservices | Nothing in Phase 1 requires them | |

Dependency checklist results (maintained, free, noncommercial use allowed, no known vulnerabilities, no lock-in
beyond Cloudflare itself) were checked on 2026-10-05. `npm audit` reports 0 vulnerabilities. The Worker bundle was
about 158 KB compressed in the foundation build, mostly Zod, and 307 KB compressed once caching was added, against
the 3 MB limit.

## Design system

ScamCam shares the "case file" idea of kevinle.tech (a manila dossier) and Live Minutes (a navy filing index):
monospace labels, file references, stamps, and redaction. Its own personality is an **evidence room seen through
a camera**, matching "Check the Scan":

| Element | ScamCam | Family resemblance |
|---|---|---|
| Palette | Dark graphite (`#0b0d0c`) with safety amber (`#f2b33d`); light theme is a warm photo-print paper | Dark and paper themes |
| Type | Big Shoulders Stencil Display for headlines (evidence crate stencils), IBM Plex Sans for reading, IBM Plex Mono for labels | IBM Plex Mono labels |
| Viewfinder | Amber focus brackets around the scan panel with a camera-style status line | |
| Exhibit tags | Luggage-tag labels ("Exhibit A") on every finding | File numbers and folders |
| Verdict stamp | Rotated double-border stamp in the risk color | Rubber stamps |
| Risk meter | Five labeled steps; the level is always written in words | Severity grades |
| Redaction | Bars showing what was hidden before checking | Redacted text |
| Texture | Faint horizontal scan lines | Paper grain |

Fonts are OFL-licensed `@fontsource` packages bundled by Vite and served from the same origin, so the CSP stays
`font-src 'self'`. Colors are CSS custom properties in `src/client/styles.css`, overridden under `.dark`, and used
through Tailwind utilities (`bg-panel`, `text-ink-soft`, `text-level-high`, and so on).

Routing is a small `History API` router in `src/client/router.tsx` (no dependency). Pages live in
`src/client/pages`. The `/design` page renders made-up reports for layout work and exists only in development builds.

## API conventions

- Versioned under `/api/v1`. The OpenAPI document is at `/api/v1/openapi.json`.
- Every error is `{ "error": { "code", "message", "requestId" } }` with no internal detail.
- Requests over 16 KB are rejected before parsing. Cross-site form posts are rejected. There is no CORS.

## Threat model

Assets: the scan engine's integrity, users' submitted content (sensitive by default), the free-tier quotas, the
reputation of verdicts, and the operator's Cloudflare account.

| Threat | Example | Mitigation |
|---|---|---|
| SSRF / active retrieval | A submitted URL points at an internal or attacker server | The Worker never fetches submitted URLs. Lookups go only to fixed provider hosts. |
| Injection | SQL in a message, script in a URL shown in the report | Bound parameters only; table names come from a fixed list; React escapes output; no `dangerouslySetInnerHTML`; strict CSP |
| Prompt injection | A message tells the AI to report "safe" or to say something else | The AI runs only when the rules found nothing; invisible characters are removed first; text aimed at checkers skips the AI and raises a warning; the message is marked as untrusted data between markers that the message cannot contain; only one known label is accepted; a label can add one warning but never lower a result; the verdict is computed from evidence. Full mapping in `OWASP_LLM_TOP_10.md` |
| Hidden characters | Zero-width characters split "free nitro" past filters, or a direction control makes `photo[U+202E]gpj.exe` look like a picture | Removed before analysis, display, and the AI, and reported as a warning |
| Poisoned community list | A legitimate domain is added to Phishing.Database | Matches never confirm, official sites are never looked up, shared services are context only, the list is size-checked and pinned to a commit |
| Quota exhaustion (denial of wallet or service) | Bots flood scans to burn D1, AI, or provider quotas | Rate limiting (per visitor and per IPv6 /64, at each Cloudflare location), Turnstile on scans, cached results, daily caps counted for the whole service (AI capped at 2,000 calls, refused when usage cannot be counted), paused failing sources, honest "temporarily unavailable" responses |
| CPU and subrequest exhaustion | A crafted message makes parsing slow, or many links push a request past the Free plan's 50 subrequests | Parsing that grows in step with input length (tested on 31 crafted inputs and 300 fuzzed ones), capped lookups, memory before the shared cache, at most 24 shared cache calls per request, provider answers read with size caps |
| Hiding a destination behind a trusted redirect | A Steam link filter or Google redirect link that points at a phishing site, so the trusted domain makes the link look safe | The destination is decoded and checked like any other link, and the wrapper loses its "official" credit; capped at 5 decoded links and 3 levels |
| Fake shared reports | Someone edits a report to say a scam is safe and shares it as ScamCam's | Shares need an HMAC signature over the unchanged report made in the last 30 minutes; shared reports are encrypted with a key only the link holds and expire within 15 minutes |
| Malicious files for the file check | A crafted archive, PDF, or SVG that hangs the page, or a file named to look harmless | Parsing runs only in the visitor's browser with fixed read limits and linear patterns (a crafted-input test keeps each under 1.5 s); archives are never unpacked; nothing is executed; the server accepts only fingerprints and enum codes |
| Malicious image files | A fake image, a script-carrying SVG, or a small file that decodes to a huge image | Images never leave the browser; only PNG, JPEG, WebP, and GIF signatures are accepted; sizes are read from the header before decoding (16,384 pixels a side, 40 megapixels, 10 MB); the browser's own decoder is used; OCR runs in a worker with time limits (see `SECURITY_REVIEW.md`, Screenshot reading) |
| Log and header injection | A client sends its own request ID or crafted headers to plant text in logs | The Worker makes its own request IDs, logs only fixed fields, and Cloudflare's per-request invocation logs are off |
| Abuse of verdicts | Someone uses ScamCam to label a competitor a scam | Signal-based wording, sources and dates shown, dispute path, no accusations against individuals |
| Data exposure | Private message or secret-bearing URL stored or cached | No raw content storage; no shared caching of private submissions; hashed indicators only |
| Supply chain | A compromised npm package | Exact versions, lockfile, audit, Dependabot, few dependencies |
| Secret leakage | Turnstile or API keys in the repo or client | `wrangler secret`, ignored `.dev.vars`, Gitleaks in CI, nothing secret in `src/client` |
| Clickjacking and XSS on the report page | Framing the site, injected markup | `frame-ancestors 'none'`, CSP without inline script, React escaping |
| Account compromise of the operator | Cloudflare or GitHub takeover | Out of the codebase: protect both of my accounts with passkeys or MFA |
| DNS rebinding | Not applicable while the Worker never resolves and fetches user-supplied hosts | Re-evaluate before any active retrieval feature |
