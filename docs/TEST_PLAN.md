# Test plan

## How tests run

| Suite | Runner | Where | Command |
|---|---|---|---|
| Worker | Vitest with `@cloudflare/vitest-plugin` | Inside workerd with a real local D1 and the rate limiting binding; migrations applied before tests | `npm run test:worker` |
| Config | `node --test` | Node 24+ | `npm run test:config` |
| Types | `tsc -b` with strict settings | | `npm run typecheck` |
| Build | Vite with the Cloudflare plugin | | `npm run build` |
| Supply chain | `npm audit --audit-level=high`, Gitleaks | CI | |

CI runs all of these on every push and pull request (`.github/workflows/ci.yml`).

## Coverage by stage

| Area | Stage 1 tests | Later |
|---|---|---|
| Core API | Health response, OpenAPI document lists routes | Scan endpoints, report schema |
| Input validation | Body size limit (413), cross-site form posts (403) | Zod schemas for every scan input, Unicode edge cases |
| Errors | Unknown routes return JSON 404; thrown errors return a generic 500 without the message or type; only the error type and route are recorded with a 7-day expiry | Provider failures shown as "not checked" |
| Rate limits | A client is limited after the configured rate with `Retry-After`; another client is unaffected | Per-provider daily budgets |
| Bot protection | Turnstile fails closed without a secret, rejects missing, oversized, failed, malformed, and wrong-hostname tokens, handles network failure | End-to-end with Turnstile test keys |
| Cleanup and retention | Daily task deletes only expired rows and records the run; storage soft limit pauses and resumes writes; weekly task reports counts and missing expiries; scheduled handler runs the right task and ignores unknown schedules | Retention for indicators and reports |
| Configuration | Cron parity between code and `wrangler.jsonc`; no public deploy target; `security.txt` fields and expiry; CSP has no `unsafe-*`; no em dashes | |
| Accessibility and mobile | Manual check: no horizontal scroll at 320 and 390 px, keyboard focus, theme toggle | Automated axe checks and contrast in Stage 2 |
| Privacy | | Assert no raw URL, message, or IP is written anywhere |
| Security | | SSRF impossibility (no fetch of submitted hosts), prompt injection cases, concurrency |

## Rules

- Never report a test as passing without running it.
- Live provider integrations are tested separately from fixtures, and reports say which was used.
