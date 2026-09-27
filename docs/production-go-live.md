# Production go-live

This checklist is the backend cutover. It does not add a migration and it does not add `migrate:revert`.

## Hosts that exist today

`infra/caddy/Caddyfile` serves a static landing from `/srv/edenbowls` for `edenbowls.com` and `edenbowls.com.br`. `www.edenbowls.com` redirects to `https://edenbowls.com`. `www.edenbowls.com.br` redirects to `https://edenbowls.com.br`.

The same file reverse-proxies only the QA hosts `qa.edenbowls.com`, `qa-admin.edenbowls.com`, and `qa-api.edenbowls.com`. Production API and admin hostnames are not in `infra/caddy/Caddyfile`. Do not invent them here. Apex blocks stay as they are.

The store repo constant `DOMAIN_COM_URL` is `https://www.edenbowls.com`. `DOMAIN_COMBR_URL` is `https://www.edenbowls.com.br`. Those `www` URLs do not match the apex redirect above. Fixing that constant is outside this backend change.

## Environment

`NODE_ENV=production` refuses to listen when any of these is blank, `change-this-in-production`, or `hsr-default-salt`:

- `JWT_AUTH_SECRET_KEY`
- `AUTH_OTP_PEPPER` or `AUTH_SALT` (the JWT secret is not a pepper)
- `AUTH_SMTP_HOST` and `AUTH_MAIL_FROM`
- Stripe US secret and webhook secret (`STRIPE_US_*`, or the legacy `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`)
- `STRIPE_BR_SECRET_KEY` and `STRIPE_BR_WEBHOOK_SECRET`
- `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`
- `METRICS_TOKEN`
- `DB_PASSWORD`

`STRIPE_BR_ENABLED` must be the literal `true` or `false`. `1`, `yes`, and `on` stop the process.

`JWT_AUTH_ISSUER` must be `https` and must not use `localhost`.

`UPS_ENV` must be `production` or `cie`. QA stays on `cie`. There is no silent fallback to CIE when `NODE_ENV` is production.

`AUTH_REFRESH_COOKIE_SECURE` must be enabled. Leave `AUTH_REFRESH_COOKIE_DOMAIN` empty so the refresh cookie stays host-only on the API host. If `CORS_ORIGINS` includes both an `edenbowls.com` host and an `edenbowls.com.br` host, `AUTH_REFRESH_COOKIE_SAME_SITE` must be `none`. A list that is only `https://qa.edenbowls.com,https://qa-admin.edenbowls.com` may stay `lax`.

`CORS_ORIGINS` in production must be an https allow-list. `http://` and `localhost` are rejected.

`GET /metrics` in production returns 404 unless `Authorization` is `Bearer` plus `METRICS_TOKEN`. `GET /health` and `GET /liveness` do not touch MySQL. `GET /readiness` runs `SELECT 1`.

## Domains and CORS

Set `CORS_ORIGINS` to the real browser origins that will call the API. QA today uses `https://qa.edenbowls.com` and `https://qa-admin.edenbowls.com`. Production origins are chosen at deploy time; they are not declared as API or admin hosts in the Caddyfile.

Store and admin production builds already read `VITE_API_BASE_URL`, `VITE_SITE_URL`, `VITE_QA_DEPLOY`, the Stripe publishable keys, and `VITE_ADMIN_API_BASE_URL`. Rebuild those apps when those values change. This checklist does not edit those repos.

## Stripe

Register webhooks at:

- `POST /stripe/v1/webhook/us`
- `POST /stripe/v1/webhook/br`

The legacy `POST /stripe/v1/webhook` is the US endpoint. Put each signing secret in `STRIPE_US_WEBHOOK_SECRET` and `STRIPE_BR_WEBHOOK_SECRET`.

## UPS

`UPS_ENV=cie` uses the UPS customer integration environment. `UPS_ENV=production` uses `https://onlinetools.ups.com`. QA keeps `cie`.

## SMTP

Set `AUTH_SMTP_HOST`, port, credentials, and `AUTH_MAIL_FROM` before boot. A blank host or from-address is rejected in production.

## MySQL and migrations

Take a `mysqldump` of the production database before `npm run migrate`. `npm run migrate` runs `src/scripts/run-migrations.js` (`initialize` then `runMigrations`). This change adds no migration.

Rollback is restore that dump and redeploy the previous image. There is no `migrate:revert` script.

## Files

Photo and label bytes stay on local disk. Compose uses named volumes at `/app/public/avatars`, `/app/public/feedback-photos`, `/app/public/pet-photos`, and `/app/ups-labels`. `./data` stays mounted read-only, so a nested label volume under `/app/data` cannot be created. Compose sets `UPS_LABEL_DIR=/app/ups-labels`. Labels are still downloaded through `GET /api/v1/admin/shipments/:id/label`.

Before dropping the old host binds, copy the existing files into the new volumes:

- `public/avatars`
- `public/feedback-photos`
- `public/pet-photos`
- the current UPS label directory (`UPS_LABEL_DIR`, default `./data/ups-labels`)

Docker healthchecks stay on `GET /health`.
