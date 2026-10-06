# Deployment

**Nothing has been deployed.** Every step below that touches Cloudflare needs Kevin's explicit approval first.

## Target

One Cloudflare Worker named `scamcam`, serving the static site and `/api/*`, attached to `scamcam.kevinle.tech` as a
Worker Custom Domain. Cloudflare creates the DNS record and certificate for that hostname only. It fails if the
hostname already has a CNAME, so check first that `scamcam` is unused (Kevin confirmed on 2026-10-05 that it is not in
the DNS). No other DNS records, Pages projects, R2 buckets, or secrets are touched.

Kevin signs in with `npx wrangler login` and types every secret into `npx wrangler secret put` himself, so no secret
passes through anyone else.

## One-time setup (needs approval)

| Step | Command or action | Changes |
|---|---|---|
| 1. Sign in | `npx wrangler login` | Grants wrangler access to the account |
| 2. Create the database | `npx wrangler d1 create scamcam` and put the returned ID in `wrangler.jsonc` | New D1 database |
| 3. Apply migrations | `npx wrangler d1 migrations apply scamcam --remote` | Tables in that database |
| 4. Turnstile | Create a widget for `scamcam.kevinle.tech` in the dashboard, set its site key as `TURNSTILE_SITE_KEY` in `wrangler.jsonc`, then `npx wrangler secret put TURNSTILE_SECRET_KEY` | New widget and secret |
| 4b. Threat intelligence keys | `npx wrangler secret put SAFE_BROWSING_API_KEY` and `npx wrangler secret put URLHAUS_AUTH_KEY` (the keys already work locally; reports say which sources were not connected) | Secrets |
| 5. Production settings | Set `APP_ENV` to `production` for the deployed environment. Workers AI needs no setup; set `AI_MODE` to `off` to switch the AI step off | Config only |
| 6. Deploy | `npm run build && npx wrangler deploy` | New Worker |
| 7. Attach the domain | Add `"routes": [{ "pattern": "scamcam.kevinle.tech", "custom_domain": true }]` and deploy again | One DNS record and one certificate |
| 8. Verify | Check the site, headers, `/api/v1/health`, `/.well-known/security.txt`, and that `kevinle.tech` is unchanged | None |

The config check in `test/node/config.test.ts` fails if `routes`, `workers_dev`, or `preview_urls` are enabled, so
a public target cannot be added by accident. Remove that guard deliberately in the approved deployment change.

## Phishing.Database sync (after the first deployment)

1. In the Cloudflare dashboard, create an API token with only **Account, D1, Edit** for this account.
2. In GitHub, add the repository secrets `CLOUDFLARE_D1_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID`.
3. Set the repository variable `PHISHING_DATABASE_SYNC` to `enabled`.
4. Run the "Phishing.Database sync" workflow once by hand and check that reports stop saying the list is not connected.

The job downloads the list at a pinned commit, refuses a list with fewer than 100,000 entries, and writes about
1,025 rows. D1 can be briefly unavailable while an import runs, so the job is scheduled for 07:37 UTC (around
midnight in California).

## Local development without a Cloudflare login

The AI binding is remote. Without `npx wrangler login`, run the dev server with `SCAMCAM_LOCAL_ONLY=1`; the AI step
then reports that it did not respond. Tests and CI always run this way.

## Continuous deployment (later)

After the first manual deployment, a GitHub Actions job can deploy `main` with a Cloudflare API token limited to
"Workers Scripts: Edit" and "D1: Edit" on this account, stored as a GitHub secret. Not set up yet.

## Rollback

`npx wrangler rollback` restores the previous Worker version. D1 Time Travel can restore the database to any minute in
the last 7 days.
