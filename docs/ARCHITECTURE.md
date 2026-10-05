# Architecture

## Overview

```
Browser ──HTTPS──> Cloudflare edge ──> one Worker "scamcam"
                                         ├── static assets (React SPA, _headers, security.txt)  free, unlimited
                                         └── /api/*  Hono app (Zod, OpenAPI)
                                               ├── D1 "scamcam"     short-lived operational data only
                                               ├── Rate limiting bindings (API and scans)
                                               └── POST /api/v1/scans -> src/engine: passive lookups only
                                                   (Turnstile, Safe Browsing hash prefixes, URLhaus host,
                                                   RDAP domain, DNS hostname)
Cron triggers ──> same Worker scheduled() ──> daily cleanup, weekly maintenance
```

Only paths under `/api/*` invoke the Worker (`run_worker_first`). Everything else is served as a static asset, which
Cloudflare does not count against the Workers request quota.

## Repository layout

| Path | Contents |
|---|---|
| `src/client` | React app: `App.tsx`, `router.tsx`, `pages`, `components` (`layout`, `scan`, `report`, `ui`), `hooks`, `lib` |
| `src/shared` | Types, labels, link extraction and redaction (`extract.ts`) shared by the site and the API; Zod schemas in `*-schema.ts` and `api.ts` so the site never bundles Zod |
| `src/engine` | The analysis engine with no Worker-specific code: URL and message analysis, Safe Browsing, RDAP, DNS, URLhaus, verdicts (see `SCAMCAM_ANALYSIS.md`) |
| `src/worker` | Worker entry (`index.ts`), Hono app (`app.ts`), `routes` (health, scans), `middleware`, `security`, `repositories`, `maintenance` |
| `migrations` | Versioned D1 schema |
| `public` | `_headers`, `.well-known/security.txt`, `robots.txt`, icon |
| `test/worker`, `test/engine` | Tests that run inside workerd with a real local D1 and a fake network |
| `test/client` | Site logic and server-rendered component tests |
| `test/node` | Configuration checks (cron parity, security.txt expiry, CSP, no em dashes) |
| `scripts/a11y.ts` | axe-core WCAG 2.2 AA audit in headless Chrome |
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
| Own punycode decoder and Safe Browsing canonicalizer | Small, tested against RFC 3492 vectors and Google's published examples, no `nodejs_compat` needed | `punycode` package or Node compatibility mode |
| Turnstile | Free, privacy-focused, no cookie banner needed when used for security | reCAPTCHA (tracking concerns), hCaptcha |
| Tailwind CSS 4 + shadcn-style components | Utility CSS with no runtime, accessible primitives copied into the repo rather than a component dependency | A component library dependency |
| `@cloudflare/vitest-plugin` | Official replacement for `vitest-pool-workers`; tests run in the real runtime with D1 | Mocked bindings (misses runtime behavior) |
| TypeScript 7 | Current stable compiler; strict settings | TypeScript 5.x |
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
| Prompt injection (Stage 4) | A message tells the AI to report "safe" | AI is optional and last; output must match a strict schema; the verdict is computed from evidence, never taken from the model |
| Quota exhaustion (denial of wallet or service) | Bots flood scans to burn D1, AI, or provider quotas | Rate limiting, Turnstile on scans, cached results, daily caps, honest "temporarily unavailable" responses |
| Abuse of verdicts | Someone uses ScamCam to label a competitor a scam | Signal-based wording, sources and dates shown, dispute path, no accusations against individuals |
| Data exposure | Private message or secret-bearing URL stored or cached | No raw content storage; no shared caching of private submissions; hashed indicators only |
| Supply chain | A compromised npm package | Exact versions, lockfile, audit, Dependabot, few dependencies |
| Secret leakage | Turnstile or API keys in the repo or client | `wrangler secret`, ignored `.dev.vars`, Gitleaks in CI, nothing secret in `src/client` |
| Clickjacking and XSS on the report page | Framing the site, injected markup | `frame-ancestors 'none'`, CSP without inline script, React escaping |
| Account compromise of the operator | Cloudflare or GitHub takeover | Out of the codebase: use passkeys or MFA on both accounts (recommended to Kevin) |
| DNS rebinding | Not applicable while the Worker never resolves and fetches user-supplied hosts | Re-evaluate before any active retrieval feature |
