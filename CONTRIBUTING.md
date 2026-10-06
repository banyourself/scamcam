# Contributing to ScamCam

I build and run ScamCam myself, and every change follows the standards below, whether I make it or someone else
proposes it. Before changing anything, read [docs/STATUS.md](docs/STATUS.md) and [docs/ROADMAP.md](docs/ROADMAP.md),
then inspect the code you are about to touch.

ScamCam is a free, public, noncommercial website that helps people decide whether a link, message, website, or
interaction can be trusted. It starts with gaming communities (Steam, Discord, Roblox, Minecraft, gaming
marketplaces). Results come from deterministic analysis and independent threat intelligence first; a small AI model
is only a last resort for inconclusive context.

## Writing and code

- Never use em dashes anywhere: code, docs, UI text, or commit messages. A config test fails on any em dash in a
  project file. It skips only the generated `worker-configuration.d.ts` and `package-lock.json`.
- Never write raw invisible or text direction characters into a project file; use `\u` escapes. A config test
  enforces this too.
- No explanatory comments or docstrings in application source code. Explanations live in `docs/`.
- Keep license notices and functional directives that tools require.
- Strict TypeScript, descriptive names, small modules, no unused imports or variables, and no duplicated logic.
- Avoid new dependencies. Before adding one, check that it is necessary, maintained, free, permits noncommercial
  use, has no known vulnerabilities, and does not create lock-in or privacy problems. Record the decision in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security and privacy

- Never hardcode or commit secrets. Secrets go in `wrangler secret` in production or in `.dev.vars` locally, which git
  ignores. The secret names are `TURNSTILE_SECRET_KEY`, `SAFE_BROWSING_API_KEY`, `URLHAUS_AUTH_KEY`, and
  `SHARE_SIGNING_KEY`. `.dev.vars.example` holds only Cloudflare's public Turnstile test keys and a local-only share
  signing key, and must never hold a real key.
- Never trust input. Validate it with Zod at the API edge.
- Never fetch a submitted URL from the Worker. Lookups are passive: hash prefixes, domain names, and cached lists.
- Never store raw submitted messages or raw URLs. Follow [docs/RETENTION_POLICY.md](docs/RETENTION_POLICY.md).
- Errors shown to users never include stack traces, internal names, or infrastructure details.
- Treat submitted text as data, never as instructions to an AI model.
- Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Cost

- The operating budget is $0. Stay on the Cloudflare Free and GitHub Free allowances. Never enable a paid plan, add a
  payment method, or call a paid model. When a quota is reached, degrade honestly (see
  [docs/COST_MODEL.md](docs/COST_MODEL.md)).
- Keep every request within the Workers Free plan: 10 ms of CPU and 50 subrequests, where outside fetches, D1
  queries, and Cache API calls all count. Scans run in the `Scanner` Durable Object, which has 30 seconds of CPU per
  request, but the Worker can fall back to scanning by itself, so the scan must still fit the Worker's subrequest
  budget. `test/worker/security.test.ts`, `test/worker/maintenance.test.ts`, and
  `test/client/performance.test.ts` count them, so keep new lookups inside those budgets.

## Process

1. Inspect the code and identify what already works.
2. Plan the smallest change that does the job.
3. Check its security and cost against the rules above.
4. Implement it.
5. Test it and fix what fails.
6. Document it: keep [docs/STATUS.md](docs/STATUS.md) current and add the change to [CHANGELOG.md](CHANGELOG.md).

Never claim something works without running it, and keep local fixtures apart from live integrations when reporting
results. A later phase in [docs/ROADMAP.md](docs/ROADMAP.md) does not start before the current one is evaluated.

## Infrastructure boundaries

- ScamCam is separate from my personal website. Do not touch other Cloudflare projects, DNS records, Pages
  deployments, R2 buckets, or secrets.
- Deployments, new Cloudflare resources, and DNS changes need my approval, one specific change at a time. That
  includes anything attached to `scamcam.kevinle.tech`.

## Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Local database | `cp .dev.vars.example .dev.vars && npm run db:migrate:local` |
| Develop | `npm run dev` |
| Type check | `npm run typecheck` |
| Tests | `npm test` (Worker tests in workerd, then config checks) |
| Build | `npm run build` |
| Accessibility audit | `npm run test:a11y` (needs Chrome; run the dev and preview servers one at a time) |
| Privacy and header check | `npm run test:privacy` (needs Chrome; browser requests, cookies, storage, security headers, and a secret scan of the build) |
| Backup and restore drill | `npm run test:recovery` (throwaway local databases only) |
| Everything | `npm run check` |
| Regenerate binding types | `npm run cf-typegen` |
| Build the Phishing.Database SQL | `npm run lists:build -- --input list.txt --out list.sql` |
| Live AI evaluation | `node scripts/ai-eval.ts --set dev` against `npm run dev` (needs `npx wrangler login`) |
| Develop without a Cloudflare login | `SCAMCAM_LOCAL_ONLY=1 npm run dev` (the AI step reports that it did not respond) |
| Check the live site | `npm run check:live` |
