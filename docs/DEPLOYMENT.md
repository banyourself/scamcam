# Deployment

**Deployed on 2026-10-05**, one step at a time. Any further change that touches Cloudflare needs my explicit approval
first. Redeploy a new version of `main` with `npm run deploy`.

## Target

One Cloudflare Worker named `scamcam`, serving the static site and `/api/*`, attached to `scamcam.kevinle.tech` as a
Worker Custom Domain. Cloudflare creates the DNS record and certificate for that hostname only. It fails if the
hostname already has a CNAME, so check first that `scamcam` is unused (I confirmed on 2026-10-05 that it is not in the
DNS). No other DNS records, Pages projects, R2 buckets, or secrets are touched.

I sign in with `npx wrangler login` and type every secret into `npx wrangler secret put` myself, so no secret passes
through anyone else.

## One-time setup

Production settings live in the `production` environment of `wrangler.jsonc`. The top-level settings stay for local
development and tests. `test/node/config.test.ts` checks that production deploys only the `scamcam` Worker to
`scamcam.kevinle.tech`, with the same limits, schedules, and log settings as development.

| Step | Who | Command or action | Changes |
|---|---|---|---|
| 1. Sign in | Me | `npx wrangler login` (done on 2026-10-05) | Grants wrangler access to the account |
| 2. Create the database | Me | `npx wrangler d1 create scamcam --location wnam`, then put the ID in `env.production.d1_databases` | One D1 database |
| 3. Apply migrations | Me | `npx wrangler d1 migrations apply scamcam --remote --env production` | Tables in that database |
| 4. Turnstile widget | Me, in the dashboard | Turnstile, Add widget: name ScamCam, hostname `scamcam.kevinle.tech`, mode Managed. Put the site key (it is public) in `env.production.vars.TURNSTILE_SITE_KEY`; keep the secret key for step 6 | One widget |
| 5. Deploy | Me | `npm run deploy`. It refuses to run with a placeholder database ID or a Turnstile test key, off `main`, with uncommitted changes, or when `main` differs from GitHub, then runs every test, builds with `CLOUDFLARE_ENV=production`, and deploys. `npm run deploy:dry-run` does everything except the upload | The Worker, and the `scamcam.kevinle.tech` custom domain (one DNS record and one certificate) |
| 6. Secrets | Me, typing each value | `npx wrangler secret put TURNSTILE_SECRET_KEY --env production`, then the same for `SAFE_BROWSING_API_KEY` and `URLHAUS_AUTH_KEY`. Until the Turnstile secret is set, scans answer "temporarily unavailable" | Three secrets |
| 7. Verify | Me | `npm run check:live`, then the checks below | None |
| 9. Scanner Durable Object | Me | Deployed with `npm run deploy`, which applies the `v1` migration that creates the SQLite-backed `Scanner` class | One Durable Object namespace |
| 8. Share signing key | Me, piped without displaying it | A random 32-byte key piped straight into `npx wrangler secret put SHARE_SIGNING_KEY --env production`; rotating it only stops sharing and flagging of reports made before the change | One secret |
| 10. More lists and flags | Me | `npx wrangler d1 migrations apply scamcam --remote --env production` applies `0006`, which rebuilds the list and usage tables with the new names (keeping their rows) and adds `result_flags`, and `0007`, which allows the `ftc_dnc` phone list; then `npm run deploy` and a run of the "Scam list sync" workflow | Three rebuilt tables and one new table |
| 11. Extra sources | Me, typing each value | `npx wrangler secret put SPAMHAUS_DQS_KEY --env production`, `npx wrangler secret put PHISHSTATS_API_KEY --env production`, and `npx wrangler secret put CLOUDFLARE_RADAR_TOKEN --env production`. The Radar token is a custom API token with Account, Radar, Read. Each source starts on the next scan after its secret is set; until then, reports list Spamhaus and PhishStats as not connected | Three secrets and one API token |
| 12. Discord, Steam, wallets, FCC numbers, email files | Me | `npx wrangler d1 migrations apply scamcam --remote --env production` applies `0008`, which rebuilds the two list tables to allow `fcc_complaints` and `scamsniffer_wallets` (keeping their rows); then `npm run deploy` and a run of the "Scam list sync" workflow. For Steam, I register a Steam Web API key for `scamcam.kevinle.tech` at steamcommunity.com/dev/apikey and type it into `npx wrangler secret put STEAM_WEB_API_KEY --env production`; until then, reports list Steam as not connected. For Discord, I create an application in the Discord Developer Portal, add a bot (it never needs to join a server), and type its token into `npx wrangler secret put DISCORD_BOT_TOKEN --env production`; without it, Discord limits the lookups by the shared Workers address and they usually answer 429. For Bitly, I create a free account, generate an access token under Developer settings, and type it into `npx wrangler secret put BITLY_TOKEN --env production`; without it, Bitly links are listed as not connected | Two rebuilt tables and up to three secrets |
| 14. Breach check and GitHub facts | Me, typing the token | `npm run deploy` adds the `PASSWORD_RATE_LIMITER` binding (20 password checks a minute per visitor); no migration. For GitHub, I create a fine-grained personal access token at github.com/settings/personal-access-tokens/new with Repository access set to Public repositories (read-only), no permissions, and an expiry date I note down, then type it into `npx wrangler secret put GITHUB_API_TOKEN --env production`. Until then, reports list GitHub as not connected; an expired token shows as did not respond and raises a `github_unavailable` alert | One rate limit binding and one secret |
| 13. Anonymous totals | Me | `npx wrangler d1 migrations apply scamcam --remote --env production` applies `0009`, which adds the `scan_totals` counter table; then `npm run deploy` | One new table |
| 15. Site lookup, password tools, and sender checks | Me | `npx wrangler d1 migrations apply scamcam --remote --env production` applies `0010`, which adds `site_data` and `site_data_parts`; then `npm run deploy`, then run the "Scam list sync" workflow once (`gh workflow run "Scam list sync"`) so the lookup data exists before the next 07:37 UTC run. Until it runs, the lookup says the lists could not be loaded | Two tables, no new secrets |

## Live checks after the first deployment

Local checks cannot see Cloudflare's own behavior, so these run once the site is live.

| Check | How | Expected |
|---|---|---|
| Automated | `npm run check:live` runs the headers, `security.txt`, browser, cookie, API, rate limit, and personal site checks below against the live site | Every check passes; any Cloudflare security cookies are listed |
| Personal site | Open `kevinle.tech` and its usual pages | Unchanged |
| Headers | `curl -sI https://scamcam.kevinle.tech/` and `curl -sI https://scamcam.kevinle.tech/api/v1/health` | CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, and CORP on the page; `no-store` on the API; no `Set-Cookie` on either |
| `security.txt` | `curl -s https://scamcam.kevinle.tech/.well-known/security.txt` and `curl -sI https://scamcam.kevinle.tech/security.txt` | The file as `text/plain`, and a 301 to it from the old path |
| Cookies | Open the site in a private window, run a scan, and look at the cookies in the browser's developer tools | None from ScamCam. If Cloudflare sets any (zone security features can), list them on the Cookies page |
| Turnstile | Run a scan through the real widget, then send a scan request without a token | The scan works; the request without a token gets 403 |
| Rate limit | Run 11 scans within a minute from one connection | The 11th gets 429 with `Retry-After` |
| CPU and subrequests | Workers metrics and Workers Logs in the dashboard after a few scans, including one with many links | CPU time per request under 10 ms; no subrequest or query limit errors |
| Restore points | `npx wrangler d1 time-travel info scamcam` | A current bookmark is shown |

## Scam list sync (after the first deployment)

1. In the Cloudflare dashboard, create an API token with only **Account, D1, Edit** for this account.
2. In GitHub, add the repository secrets `CLOUDFLARE_D1_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID`.
3. Set the repository variable `PHISHING_DATABASE_SYNC` to `enabled` (the name dates from when there was one list).
4. Run the "Scam list sync" workflow once by hand and check that reports stop saying the lists are not connected.

The job runs `scripts/sync-lists.sh`. It downloads each GitHub list at the latest commit that changed it and CERT
Polska's list with its `Last-Modified` date, refuses any list outside its expected size, and writes 1,025 rows per
list, about 6,150 in all. `npm run lists:sync` builds the same files locally without writing anything; add
`WRITE_TO_D1=1` to write them. D1 can be briefly unavailable while an import runs, so the job is scheduled for 07:37
UTC (around midnight in California).

## Local development without a Cloudflare login

The AI binding is remote. Without `npx wrangler login`, run the dev server with `SCAMCAM_LOCAL_ONLY=1`; the AI step
then reports that it did not respond. Tests and CI always run this way.

## Continuous deployment (later)

After the first manual deployment, a GitHub Actions job can deploy `main` with a Cloudflare API token limited to
"Workers Scripts: Edit" and "D1: Edit" on this account, stored as a GitHub secret. Not set up yet.

## Rollback

`npx wrangler rollback` restores the previous Worker version. D1 Time Travel can restore the database to any minute in
the last 7 days. Both, and every other recovery step, are in `RECOVERY.md`.

## Build output

Never commit `dist/`. For `vite preview`, the Cloudflare Vite plugin copies `.dev.vars` into `dist/scamcam/`. The
generated `dist/client/.assetsignore` keeps it and `wrangler.json` out of the public assets, and
`npm run test:privacy` checks that no secret value appears in any other built file. Production secrets are set with
`npx wrangler secret put`; `.dev.vars` is for local use only.
