# Architecture

## Overview

```
Browser ──HTTPS──> Cloudflare edge ──> one Worker "scamcam"
                                         ├── static assets (React SPA, _headers, security.txt)  free, unlimited
                                         └── /api/*  Hono app (Zod, OpenAPI)
                                               ├── D1 "scamcam"     short-lived operational data only
                                               ├── Rate limiting binding
                                               └── (Stage 3) passive lookups: Safe Browsing hash prefixes,
                                                   RDAP, DNS over HTTPS, cached blocklists
Cron triggers ──> same Worker scheduled() ──> daily cleanup, weekly maintenance
```

Only paths under `/api/*` invoke the Worker (`run_worker_first`). Everything else is served as a static asset, which
Cloudflare does not count against the Workers request quota.

## Repository layout

| Path | Contents |
|---|---|
| `src/client` | React app: `App.tsx`, `components/ui` (shadcn-style), `hooks`, `lib` |
| `src/shared` | Zod schemas and types shared by the API and the site |
| `src/worker` | Worker entry (`index.ts`), Hono app (`app.ts`), `routes`, `middleware`, `security`, `repositories`, `maintenance` |
| `migrations` | Versioned D1 schema |
| `public` | `_headers`, `.well-known/security.txt`, `robots.txt`, icon |
| `test/worker` | Tests that run inside workerd with a real local D1 |
| `test/node` | Configuration checks (cron parity, security.txt expiry, CSP, no em dashes) |
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
| Turnstile | Free, privacy-focused, no cookie banner needed when used for security | reCAPTCHA (tracking concerns), hCaptcha |
| Tailwind CSS 4 + shadcn-style components | Utility CSS with no runtime, accessible primitives copied into the repo rather than a component dependency | A component library dependency |
| `@cloudflare/vitest-plugin` | Official replacement for `vitest-pool-workers`; tests run in the real runtime with D1 | Mocked bindings (misses runtime behavior) |
| TypeScript 7 | Current stable compiler; strict settings | TypeScript 5.x |
| No Docker, Redis, VMs, Python, Go, or microservices | Nothing in Phase 1 requires them | |

Dependency checklist results (maintained, free, noncommercial use allowed, no known vulnerabilities, no lock-in
beyond Cloudflare itself) were checked on 2026-10-05. `npm audit` reports 0 vulnerabilities. The Worker bundle is
about 158 KB compressed, mostly Zod; the budget is reviewed in Stage 4.

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
