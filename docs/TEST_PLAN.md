# Test plan

## How tests run

| Suite | Runner | Where | Command |
|---|---|---|---|
| Worker | Vitest with `@cloudflare/vitest-plugin` | Inside workerd with a real local D1 and the rate limiting binding; migrations applied before tests | `npm run test:worker` |
| Client | Vitest (node environment, React server rendering) | | `npm run test:worker` runs both Vitest projects |
| Engine | Vitest in workerd with a fake network that records every outgoing request | | part of `npm run test:worker` |
| Benchmark | `test/client/benchmark.test.ts`: 69 labeled cases with outside sources switched off; fails on any false positive or recall under 0.9 | Node | part of `npm run test:worker`; print metrics with `npx vitest run --project client test/client/benchmark.test.ts --silent=false --reporter=verbose` |
| Performance | `test/client/performance.test.ts`: every benchmark case with all outside sources answering, cold and warm; fails if a scan could approach the subrequest limit or a repeated scan makes any outside call | Node | part of `npm run test:worker` |
| AI evaluation | `scripts/ai-eval.ts` against a local dev server with the real Workers AI binding; tuning set `test/fixtures/ai-eval-cases.ts`, holdout set `test/fixtures/ai-holdout-cases.ts` | Needs a Cloudflare login; uses a few hundred free neurons | `node scripts/ai-eval.ts --set dev` or `--set holdout` |
| Accessibility | `scripts/a11y.ts`: builds, serves, and runs axe-core (WCAG 2.0, 2.1, 2.2 A and AA) in headless Chrome on every page, dark and light, at 1280 and 320 px, plus a real scan through Turnstile's test keys and the report it produces; fails on any violation, sideways scrolling, or a page that rendered the wrong route | Node 24+ and Chrome; the scan step needs internet | `npm run test:a11y` |
| Config | `node --test` | Node 24+ | `npm run test:config` |
| Types | `tsc -b` with strict settings | | `npm run typecheck` |
| Build | Vite with the Cloudflare plugin | | `npm run build` |
| Supply chain | `npm audit --audit-level=high`, Gitleaks | CI | |

CI runs all of these on every push and pull request (`.github/workflows/ci.yml`).

## Coverage by stage

| Area | Stage 1 tests | Later |
|---|---|---|
| Core API | Health response, OpenAPI document lists routes; Stage 3: the scan endpoint returns schema-valid reports | |
| Input validation | Body size limit (413), cross-site form posts (403); Stage 3: empty, oversized, and malformed scan bodies return a generic 400 | More Unicode edge cases |
| Errors | Unknown routes return JSON 404; thrown errors return a generic 500 without the message or type; only the error type and route are recorded with a 7-day expiry | Provider failures shown as "not checked" |
| Rate limits | A client is limited after the configured rate with `Retry-After`; another client is unaffected; Stage 3: 10 scans per minute, and the Safe Browsing daily budget is counted in D1 and reported as over budget | |
| Bot protection | Turnstile fails closed without a secret, rejects missing, oversized, failed, malformed, and wrong-hostname tokens, handles network failure; Stage 3: the scan endpoint returns 403 or 503 accordingly, checks the hostname in production, and a real end-to-end scan passes with Turnstile's test keys | |
| Cleanup and retention | Daily task deletes only expired rows and records the run; storage soft limit pauses and resumes writes; weekly task reports counts and missing expiries; scheduled handler runs the right task and ignores unknown schedules | Retention for indicators and reports |
| Configuration | Cron parity between code and `wrangler.jsonc`; no public deploy target; `security.txt` fields and expiry; CSP has no `unsafe-*`; no em dashes | |
| Accessibility and mobile | Stage 2: axe audit of 11 public pages and the report preview in both themes at two widths (48 checks); verified to fail when an image without alt text and low-contrast text are planted | Manual screen reader pass before launch |
| Site logic | Stage 2: link extraction (schemes, look-alikes, punycode, duplicates, cap), redaction of emails, phones, and codes without breaking URLs, truncation; report view writes the level in words, labels exhibits with source and time, lists unchecked sources, never calls a clean result safe, shows Google attribution only with Safe Browsing evidence, escapes hostile content | |
| Privacy | Stage 3: after a scan, every D1 table is inspected for the submitted text; every outgoing request is checked so it never contains the link path, query, or message | |
| Detection | Stage 3: Google's 35 canonicalization examples and expression examples, punycode against Node's decoder, look-alikes (typos, other alphabets, the @ trick, prefixes, wrong endings, digit swaps), message rules on scam scripts and on normal chat, verdicts for official, unknown, Safe Browsing, URLhaus, shared hosts, budgets, and outages; after Stage 3: the protobuf reader on valid and malformed input, and Google's recorded live answers for its three test pages | Held-out benchmark from real public indicators |
| Security | Stage 3: outbound requests go only to fixed provider hosts (the fake network answers nothing else); Stage 4: the AI sees only redacted text without links, markers cannot be forged, only known labels count, a label can never lower a result, and the AI does not run when its usage cannot be counted | Concurrency under load |
| Caching | Stage 4: Safe Browsing caches every queried prefix for Google's duration, negative results included, asks only for uncached prefixes, charges the budget only for real calls, and still shows cached warnings during an outage; URLhaus, RDAP, and DNS keep answers for their rules, never cache failures, and RDAP backs off after 429; identical lookups share one request; a failing source pauses after three failures; keys never contain the looked-up name; a repeated scan through Cloudflare's cache makes no provider calls | |
| Phishing.Database | Stage 4: entry normalization, shard building, binary search with no false hits, names checked per link, SQL safety checks, real shards read back from D1, stale and missing lists, version changes, in-place replacement, cleanup after a week, and the builder script refusing a cut-off list | Real-data benchmark |

## Rules

- Never report a test as passing without running it.
- Live provider integrations are tested separately from fixtures, and reports say which was used.
