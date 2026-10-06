# Architecture

## Overview

```
Browser ──HTTPS──> Cloudflare edge ──> one Worker "scamcam"
                                         ├── static assets (React SPA, _headers, security.txt)  free, unlimited
                                         └── /api/*  Hono app (Zod, OpenAPI)
                                               ├── D1 "scamcam"     operational data and the hashed Phishing.Database copy
                                               ├── Rate limiting bindings (API and scans)
                                               ├── Named cache "scamcam-lookups"  provider answers under hashed keys
                                               ├── Workers AI (Qwen3 30B A3B)     only for messages the rules cannot decide
                                               └── POST /api/v1/scans -> src/engine: passive lookups only
                                                   (Turnstile, Safe Browsing hash prefixes, URLhaus host,
                                                   RDAP domain, DNS hostname)
Cron triggers ──> same Worker scheduled() ──> daily cleanup, weekly maintenance
GitHub Actions (daily) ──> Phishing.Database list ──> scripts/domain-list.ts ──> D1 shards
```

Only paths under `/api/*` invoke the Worker (`run_worker_first`). Everything else is served as a static asset, which
Cloudflare does not count against the Workers request quota.

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
| Named Cache API cache for provider answers | Free, no write quota, expiry through `Cache-Control`, kept apart from the site's page cache; keys are hashes on the site's own origin | KV (1,000 writes a day on Free), D1 (a write per lookup) |
| Hashed Phishing.Database shards in D1, built by GitHub Actions | A daily sync writes about 1,025 rows and a check reads one; the 11 MB list is far too much for a Worker's 10 ms of CPU on Free | One row per domain (about 500,000 writes per refresh), KV, static assets (stale between deploys) |
| Workers AI with Qwen3 30B A3B for unclear messages | Free allocation, Apache 2.0, caught 80 percent of scams in the evaluation sets with no false alarms, about 2.1 neurons a call | Granite 4.0 Micro (cheaper, more false alarms), larger models (5 to 10 times the neurons) |
| Remote bindings off in tests and CI | Tests use a fake model and CI has no Cloudflare login; the local dev server still reaches the real model | Running CI against a real account |
| Own Protocol Buffers reader for Safe Browsing answers | Safe Browsing v5 answers only in binary Protocol Buffers. The reader is about 60 lines, rejects malformed input, and was checked against Google's live answers | `protobufjs` (a large dependency for three small messages) |
| Own punycode decoder and Safe Browsing canonicalizer | Small, tested against RFC 3492 vectors and Google's published examples, no `nodejs_compat` needed | `punycode` package or Node compatibility mode |
| Turnstile | Free, privacy-focused, no cookie banner needed when used for security | reCAPTCHA (tracking concerns), hCaptcha |
| Tailwind CSS 4 + shadcn-style components | Utility CSS with no runtime, accessible primitives copied into the repo rather than a component dependency | A component library dependency |
| `@cloudflare/vitest-plugin` | Official replacement for `vitest-pool-workers`; tests run in the real runtime with D1 | Mocked bindings (misses runtime behavior) |
| TypeScript 7 | Current stable compiler; strict settings | TypeScript 5.x |
| Vitest 4, held at the major version | `@cloudflare/vitest-plugin` 1.3.6 supports only `vitest` `^4.1.0`; Dependabot ignores Vitest major updates until the plugin supports the next one, then both move together | Vitest 5 (`npm ci` fails with a peer dependency conflict) |
| `@types/node` 24 | Matches Node 24, the minimum version and the one CI and the dev container use, so code cannot rely on newer Node APIs by accident; Dependabot ignores its major updates | Newer `@types/node` majors |
| No Docker, Redis, VMs, Python, Go, or microservices | Nothing in Phase 1 requires them | |

Dependency checklist results (maintained, free, noncommercial use allowed, no known vulnerabilities, no lock-in
beyond Cloudflare itself) were checked on 2026-10-05. `npm audit` reports 0 vulnerabilities. The Worker bundle is
about 158 KB compressed, mostly Zod; the budget is reviewed in Stage 4.

## Design system

ScamCam shares the "case file" idea of kevinle.tech (a manila dossier) and Live Minutes (a navy filing index):
monospace labels, file references, stamps, and redaction. Its own personality is an **evidence room seen through
a camera**, matching "Put scams in focus":

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
| Prompt injection | A message tells the AI to report "safe" or to say something else | The AI runs only when the rules found nothing; the message is marked as untrusted data between markers that the message cannot contain; only one known label is accepted; a label can add one warning but never lower a result; the verdict is computed from evidence |
| Quota exhaustion (denial of wallet or service) | Bots flood scans to burn D1, AI, or provider quotas | Rate limiting, Turnstile on scans, cached results, daily caps (AI capped at 2,000 calls, refused when usage cannot be counted), paused failing sources, honest "temporarily unavailable" responses |
| Abuse of verdicts | Someone uses ScamCam to label a competitor a scam | Signal-based wording, sources and dates shown, dispute path, no accusations against individuals |
| Data exposure | Private message or secret-bearing URL stored or cached | No raw content storage; no shared caching of private submissions; hashed indicators only |
| Supply chain | A compromised npm package | Exact versions, lockfile, audit, Dependabot, few dependencies |
| Secret leakage | Turnstile or API keys in the repo or client | `wrangler secret`, ignored `.dev.vars`, Gitleaks in CI, nothing secret in `src/client` |
| Clickjacking and XSS on the report page | Framing the site, injected markup | `frame-ancestors 'none'`, CSP without inline script, React escaping |
| Account compromise of the operator | Cloudflare or GitHub takeover | Out of the codebase: use passkeys or MFA on both accounts (recommended to Kevin) |
| DNS rebinding | Not applicable while the Worker never resolves and fetches user-supplied hosts | Re-evaluate before any active retrieval feature |
