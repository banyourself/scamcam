# Deployment

**Nothing has been deployed.** Every step below that touches Cloudflare needs Kevin's explicit approval first.

## Target

One Cloudflare Worker named `scamcam`, serving the static site and `/api/*`, attached to `scamcam.kevinle.tech` as a
Worker Custom Domain. Cloudflare creates the DNS record and certificate for that hostname only. It fails if the
hostname already has a CNAME, so check first that `scamcam` is unused. No other DNS records, Pages projects, R2
buckets, or secrets are touched.

## One-time setup (needs approval)

| Step | Command or action | Changes |
|---|---|---|
| 1. Sign in | `npx wrangler login` | Grants wrangler access to the account |
| 2. Create the database | `npx wrangler d1 create scamcam` and put the returned ID in `wrangler.jsonc` | New D1 database |
| 3. Apply migrations | `npx wrangler d1 migrations apply scamcam --remote` | Tables in that database |
| 4. Turnstile | Create a widget for `scamcam.kevinle.tech` in the dashboard, set its site key as `TURNSTILE_SITE_KEY` in `wrangler.jsonc`, then `npx wrangler secret put TURNSTILE_SECRET_KEY` | New widget and secret |
| 4b. Threat intelligence keys | `npx wrangler secret put SAFE_BROWSING_API_KEY` and `npx wrangler secret put URLHAUS_AUTH_KEY` (both optional; reports say which sources were not connected) | Secrets |
| 5. Production settings | Set `APP_ENV` to `production` for the deployed environment | Config only |
| 6. Deploy | `npm run build && npx wrangler deploy` | New Worker |
| 7. Attach the domain | Add `"routes": [{ "pattern": "scamcam.kevinle.tech", "custom_domain": true }]` and deploy again | One DNS record and one certificate |
| 8. Verify | Check the site, headers, `/api/v1/health`, `/.well-known/security.txt`, and that `kevinle.tech` is unchanged | None |

The config check in `test/node/config.test.ts` fails if `routes`, `workers_dev`, or `preview_urls` are enabled, so
a public target cannot be added by accident. Remove that guard deliberately in the approved deployment change.

## Continuous deployment (later)

After the first manual deployment, a GitHub Actions job can deploy `main` with a Cloudflare API token limited to
"Workers Scripts: Edit" and "D1: Edit" on this account, stored as a GitHub secret. Not set up yet.

## Rollback

`npx wrangler rollback` restores the previous Worker version. D1 Time Travel can restore the database to any minute in
the last 7 days.
