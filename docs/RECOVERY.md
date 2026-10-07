# Recovery runbook

**ScamCam has been live since 2026-10-05.** Every command below with `--remote`, and every change in the Cloudflare
dashboard, acts on the live service and needs my approval. The local drill at the end touches nothing outside the
local machine.

## What ScamCam keeps, and what losing it costs

ScamCam stores no messages, links, IP addresses, or accounts, so there is no user data to recover and no one to
notify if the database is lost.

| Table | Holds | If it is lost |
|---|---|---|
| `provider_usage` | Calls per provider per day, kept 35 days | Today's counts restart at zero, so one day's free quota could be used twice; each source is still capped |
| `maintenance_runs` | Run history and reports, kept 90 days | History only |
| `error_events` | Error type and route, kept 7 days | Debugging history only |
| `app_state` | Whether optional writes are paused | The next daily task sets it again |
| `domain_lists`, `domain_list_shards` | The hashed Phishing.Database copy | Rerun the sync (about a minute); until then reports say the list is not connected |
| `d1_migrations` | Which migrations ran | Apply the migrations again |

## Scenarios

### A bad deploy

1. `npx wrangler deployments list` shows recent versions.
2. `npx wrangler rollback <version-id>` serves the previous version again. The database is not changed.

### A bad migration or damaged data

D1 Time Travel keeps restore points for the last 7 days on the Free plan (30 days on Paid).

1. `npx wrangler d1 time-travel info scamcam` shows the current bookmark.
2. `npx wrangler d1 time-travel restore scamcam --timestamp=<unix seconds>` restores to that moment. Cloudflare's docs
   call this a destructive operation: it overwrites the database in place and cancels queries that are running.
3. `npx wrangler d1 migrations list scamcam --remote` should report nothing to apply.

### Starting over

If the database is gone or not worth restoring:

1. `npx wrangler d1 create scamcam` and put the new ID in `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply scamcam --remote`.
3. `npm run build && npx wrangler deploy`.
4. Run the "Phishing.Database sync" workflow by hand.

### A portable copy before a risky change

`npx wrangler d1 export scamcam --remote --output backup.sql` writes the schema and data, and
`npx wrangler d1 execute <database> --remote --file backup.sql` loads it into an empty database. Time Travel is faster
for going back; an export is a copy that does not depend on the original database.

### A leaked secret

Replace the secret first, then remove the old one, so checking keeps working.

| Secret | Replace | Then |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Rotate the secret in the Turnstile widget settings, then `npx wrangler secret put TURNSTILE_SECRET_KEY` | Check that a scan works |
| `SAFE_BROWSING_API_KEY` | Create a new key restricted to the Safe Browsing API, then `npx wrangler secret put SAFE_BROWSING_API_KEY` | Delete the old key in Google Cloud |
| `URLHAUS_AUTH_KEY` | Create a new Auth-Key at abuse.ch, then `npx wrangler secret put URLHAUS_AUTH_KEY` | Revoke the old key |
| `CLOUDFLARE_D1_TOKEN` (GitHub) | Roll the token in the Cloudflare dashboard and update the GitHub secret | Rerun the sync workflow |
| `SPAMHAUS_DQS_KEY` | Ask Spamhaus for a new DQS key in its customer portal, then `npx wrangler secret put SPAMHAUS_DQS_KEY --env production` | Ask Spamhaus to retire the old key |
| `PHISHSTATS_API_KEY` | Create a new key at phishstats.info (Settings, API keys), then `npx wrangler secret put PHISHSTATS_API_KEY --env production` | Delete the old key there |
| `CLOUDFLARE_RADAR_TOKEN` | Roll the token in the Cloudflare dashboard, then `npx wrangler secret put CLOUDFLARE_RADAR_TOKEN --env production` | The old value stops working when rolled |
| `STEAM_WEB_API_KEY` | Revoke the key and register a new one at steamcommunity.com/dev/apikey, then `npx wrangler secret put STEAM_WEB_API_KEY --env production` | The old key stops working when revoked |
| `DISCORD_BOT_TOKEN` | Reset the token on the bot page of the Discord Developer Portal, then `npx wrangler secret put DISCORD_BOT_TOKEN --env production` | The old token stops working when reset |

Then read the usage section of the next weekly report for calls that do not match normal traffic.

### A provider is down or out of quota

Nothing needs to be done. A source pauses for a minute after three failures in a row, a daily budget stops calls to
that source, and reports list it under "not checked". To switch the AI step off, set `AI_MODE` to `off` and deploy.

### An abuse spike

Turnstile and the scan limit (10 a minute per visitor at each Cloudflare location) come first, and the daily budgets
cap provider use for the whole service. Limits can be lowered in `wrangler.jsonc` and deployed. Any WAF rule or zone
setting would change `kevinle.tech` and needs my approval.

### The list sync fails

The "Scam list sync" workflow runs `scripts/sync-lists.sh`, which syncs each of the six lists on its own and fails
the run if any of them failed, naming them at the end. It can be rerun by hand, and lists that did sync are not
harmed by a rerun. A copy's age counts from the time its source
commit was published, not from when ScamCam copied it, so a stalled upstream project shows up the same way as a failed
sync. Reports say how old a copy is once it is more than a day old, the weekly report raises `phishing_list_stale`
(or `<list>_list_stale` for the other lists) after 2 days, reports stop using a copy after 7 days, and the daily
cleanup deletes it 10 days after its last sync. CERT Polska's list stops being used after 3 days, and DevSpen's
Discord and Steam list, which changes rarely, after a year, with its alert at 180 days. A sync that has not run for 2
days raises `scam_list_sync_late`, and a list with no copy at all raises `scam_list_missing`. GitHub runs scheduled
workflows on a best-effort basis, so a sync can start hours late. A sync that stops partway leaves a mix of old and new
shards that still answers correctly (tested).

### Storage is nearly full

Maintenance raises `storage_near_soft_limit` at 80 percent of `STORAGE_SOFT_LIMIT_BYTES` (80 MB), pauses optional
writes at the limit, and resumes them when cleanup frees space.

## Alerts

Daily and weekly maintenance write a JSON report to `maintenance_runs.detail_json` and log one
`{"event":"alert",...}` line per alert. Workers Logs keep these for 3 days on the Free plan; the run history keeps
them for 90 days.

| Alert | Meaning |
|---|---|
| `safe_browsing_near_daily_limit`, `urlhaus_near_daily_limit`, `workers_ai_near_daily_limit`, `phishstats_near_daily_limit` | A day used at least 80 percent of that source's daily budget (daily report: today and yesterday; weekly report: the last 7 days) |
| `storage_near_soft_limit`, `storage_over_soft_limit` | The database is at 80 percent of the soft limit, or past it with optional writes paused |
| `maintenance_failed` | A maintenance run failed in the last day (daily) or week (weekly), or the current run failed |
| `maintenance_stuck` | A run has said "running" for more than 6 hours |
| `cleanup_backlog_<table>` | The daily cleanup used its budget of 26 delete batches (500 rows each, shared by all tables) before it finished that table; the rest is deleted on the next runs |
| `errors_high` | At least 50 errors in the last 7 days |
| `phishing_list_stale`, `metamask_list_stale`, `scamsniffer_list_stale`, `phishdestroy_list_stale`, `scam_links_list_stale`, `cert_polska_list_stale`, `ftc_dnc_list_stale`, `fcc_complaints_list_stale`, `scamsniffer_wallets_list_stale` | That list's source data is older than its alert age (2 days; 4 for `fcc_complaints`; 5 for `ftc_dnc` because the FTC publishes only on weekdays; 7 for `scamsniffer_wallets`, whose address list changes less often; 180 for `scam_links`), whether the sync failed or the upstream project stopped publishing |
| `scam_list_sync_late` | At least one list has not been refreshed by the sync for more than 2 days |
| D1 "operations are nearing the daily cap" email from Cloudflare | More than about 80,000 rows were written in one UTC day. Each list sync writes about 28,000 (rows plus index entries), so extra manual syncs or a migration that rebuilds the list tables add up quickly. Do not run another sync that day; `scripts/sync-lists.sh` already skips lists refreshed in the last 20 hours unless `FORCE_SYNC=1`. If the limit is passed, writes fail until 00:00 UTC, scans report budgeted sources as over budget, and flags and shares fail |
| `scam_list_missing` | At least one of the nine lists has no copy in D1, so reports check fewer lists, phone numbers, or wallets |
| `spamhaus_unavailable` | Spamhaus did not answer through Cloudflare's resolver, refused, or returned an error code (logged at most every 10 minutes with only the reason or HTTP status, never the query). Check the key and the free DQS usage limit |
| `phishstats_unavailable`, `radar_unavailable` | PhishStats or Cloudflare Radar answered with an error or did not answer (logged at most every 10 minutes with the HTTP status and the provider's message). A 401 or 403 means the key or token needs checking, and a 429 means the daily quota ran out |
| `urlhaus_unavailable`, `threatfox_unavailable`, `malwarebazaar_unavailable` | An abuse.ch API answered with an error or did not answer in time (logged at most every 10 minutes with the HTTP status and abuse.ch's message, or the error name such as `TimeoutError`, never the host, file fingerprint, or key). A 401 means the Auth-Key needs checking |
| `discord_unavailable`, `steam_unavailable` | Discord's invite endpoint or the Steam Web API answered with an error or did not answer (logged at most every 10 minutes with the HTTP status and the provider's message, never the invite, the profile, or the key). An unknown invite (404) is a normal answer and raises nothing. For Steam, a 403 means the key needs checking; for Discord, a 429 means its rate limit for Cloudflare's addresses was reached |
| `flags_waiting` | At least one flagged result is waiting for review. Run `npm run flags` |
| `flags_daily_limit` | The daily cap on flags was reached, so new flags are refused until midnight UTC |
| `scanner_unavailable` | A scan could not reach the Scanner Durable Object, so the Worker ran it itself; scans still work, but repeated alerts mean the scanner or its free quota needs a look |
| `share_cleanup_failed` | The 5-minute cleanup of expired share links failed; reads still refuse expired links |
| `rows_missing_expiry` | A row has no expiry, so cleanup would never delete it |

To read the latest reports: `npx wrangler d1 execute scamcam --remote --command "SELECT task, status, finished_at,
detail_json FROM maintenance_runs ORDER BY id DESC LIMIT 5"`.

## Drill

`npm run test:recovery` runs `scripts/recovery-drill.ts` on two throwaway local databases. It applies every
migration to the first, adds sample rows and a 20,000-entry list, exports it with `wrangler d1 export`, loads the
export into the second, and compares every table and the migration history. CI runs it on every push.

| Where | Export | Restore | Result |
|---|---|---|---|
| Windows PC, 2026-10-06 | 1,124 ms, 645 KB | 3,317 ms | All 9 tables matched, including shared reports, flags, and two lists; no migrations pending |
| Windows PC, 2026-10-05 | 991 ms, 469 KB | 2,041 ms | All 7 tables matched; no migrations pending |
| GitHub Actions (Ubuntu), 2026-10-05 | 1,453 ms, 469 KB | 2,860 ms | All 7 tables matched; no migrations pending |

After deployment, run `npx wrangler d1 time-travel info scamcam` once to confirm that restore points exist.
