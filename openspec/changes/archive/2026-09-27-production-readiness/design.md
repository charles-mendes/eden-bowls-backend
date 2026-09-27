# Design

## Context

See proposal.md for why. This design only records the approach.

The boot contract is `parseEnv` in `src/config/env.js`. It already throws when production disables `AUTH_REFRESH_COOKIE_SECURE`, and when `SameSite=none` is set without `Secure`. `rawEnvSchema` does not declare `UPS_*`. Zod strips those keys, so `parseEnv` always falls through to `UPS_ENV=cie` and empty credentials. Confirmed by calling `parseEnv` with `UPS_ENV=production` and `UPS_CLIENT_ID` set: the result was `upsEnv: "cie"` and an empty client id.

`createApp` in `src/app.js` serves `/health`, `/liveness`, `/readiness`, and `/metrics` before the route modules. All four ignore MySQL. `/metrics` uses the existing `prom-client` registry and has no auth. CORS is an allow-list echo with credentials; disallowed `OPTIONS` is already 403.

Refresh cookies are built in `src/api/routes/auth.routes.js` with `HttpOnly` hardcoded. `Secure` and `SameSite` come from env. `AUTH_REFRESH_COOKIE_DOMAIN` is optional and empty by default. `.env.qa.example` already says not to set `Domain=.edenbowls.com`.

Files are written by `LocalAvatarStorage`, `LocalPetPhotoStorage`, `LocalFeedbackPhotoStorage`, and `LocalUpsLabelStorage`. Filenames include a random UUID. Compose bind-mounts `./public/avatars`, `./public/feedback-photos`, and `./public/pet-photos`. `./data` is mounted read-only, and the label default `./data/ups-labels` sits inside that mount. MySQL already uses named volumes `eden-bowls-mysql-data` and `eden-bowls-mysql-qa-data`. No S3, GCS, or MinIO client exists in the backend.

`infra/caddy/Caddyfile` reverse-proxies `qa.edenbowls.com`, `qa-admin.edenbowls.com`, and `qa-api.edenbowls.com`. `edenbowls.com` and `edenbowls.com.br` serve `/srv/edenbowls`. `www` 301s to the apex. The store repo hardcodes `DOMAIN_COM_URL` as `https://www.edenbowls.com` and `DOMAIN_COMBR_URL` as `https://www.edenbowls.com.br`.

`npm run migrate` runs `src/scripts/run-migrations.js` (`initialize` + `runMigrations`). There is no revert script. `1700000000007` has an empty `down`. QA sets `NODE_ENV=production`.

Table names that start with `wp_` are env defaults in `parseEnv`. This change does not treat them as a running WordPress dependency and does not rename them.

## Goals / Non-Goals

**Goals:**

- Fail closed in `parseEnv` for the production secret set, without a second config system.
- Make `UPS_ENV` reach `UpsClient`, whose `baseUrl` already switches on the string `production`.
- Probe MySQL with the `DataSource` `index.js` already constructs.
- Persist the four local directories with the volume style MySQL already uses.
- Leave a checklist an operator can follow without guessing hostnames that are not in the repo.

**Non-Goals:**

- Object storage, a new metrics product, or a new health library.
- Rewriting apex Caddy blocks to the SPA before production API and admin hostnames exist.
- Editing `eden-bowls` or `eden-bowls-admin` from this change. Apply is limited to this repo.
- Locking `/avatars`, `/pet-photos`, `/feedback-photos`, `/api/v1/products`, `/api/v1/breeds`, `/api/v1/geo/context`, `/api/v1/public/feedbacks`, `/shipping/v1/settings`, or the Stripe webhook paths. Those are public today on purpose. Label download stays on `GET /api/v1/admin/shipments/:id/label`.

## Decisions

### 1. Production guard lives in `parseEnv`

Throw `Error` the same way the cookie `Secure` check already does, only when `NODE_ENV === 'production'`. Development and test skip the new checks.

Rejected: a separate `PRODUCTION_STRICT` flag. QA already runs `NODE_ENV=production`, so a second flag would let the QA VPS keep the empty pepper. The guard belongs on the value QA already sets.

Rejected: requiring `UPS_ENV=production` whenever `NODE_ENV=production`. That would send the QA VPS to live UPS. Production requires the variable to be explicit (`production` or `cie`) and requires the three credentials. The go-live checklist is what sets `production` for the live cutover.

Placeholder rejection is exact: JWT `change-this-in-production` (the value in `.env.qa.example`) and pepper `hsr-default-salt` (the code fallback).

In production, `STRIPE_BR_ENABLED` must be present and the trimmed value must be `true` or `false`, case-insensitive. `1`, `yes`, and `on` are rejected even though `toBoolean` would treat them as true. After that check, `toBoolean` still maps `true` to enabled and `false` to disabled. The flag must be present so the silent default `false` cannot hide a missing choice. BR secret and webhook are required in production either way, so turning the flag on later does not also require inventing keys.

### 2. Declare `UPS_*` on `rawEnvSchema`

Add the keys `.env.example` already documents: `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`, `UPS_ENV`, `UPS_HTTP_TIMEOUT_MS`, `UPS_TRANSACTION_SRC`, `UPS_LABEL_DIR`. Add `METRICS_TOKEN` the same way. No new parser.

`UpsClient` already maps anything other than `production` to CIE and `production` to `https://onlinetools.ups.com`. Do not add a third environment name.

### 3. Cookies and CORS stay on the current mechanism

Extend the existing throws in `parseEnv`:

- Production and non-empty `AUTH_REFRESH_COOKIE_DOMAIN` → throw. Host-only cookie on the API host. One cookie cannot be same-site for both `.com` and `.com.br`.
- If the parsed CORS list contains both a host of `edenbowls.com` (or a subdomain that does not end in `.com.br`) and a host that is `edenbowls.com.br` or ends in `.com.br`, production requires `AUTH_REFRESH_COOKIE_SAME_SITE=none`. QA's list (`qa.edenbowls.com`, `qa-admin.edenbowls.com`) does not match, so QA can keep `lax`.
- Production CORS entries must be `https` and must not contain `localhost`. The middleware stays as it is: echo the allowed origin, set credentials, 403 on disallowed `OPTIONS`.

`Set-Cookie` construction in `auth.routes.js` already emits `HttpOnly`, `Secure`, and `SameSite`. No new cookie library.

### 4. Metrics token, probes unchanged in shape

In production, `GET /metrics` returns 404 unless `Authorization` is `Bearer` plus `METRICS_TOKEN`. Compare SHA-256 digests of the presented token and `METRICS_TOKEN` with `crypto.timingSafeEqual`. The digests are always the same length, so a shorter or longer bearer token returns 404 and does not throw. Do not call `timingSafeEqual` on the raw strings. 404, not 401, so a scan does not learn the route is a metrics endpoint. Outside production the route stays open, matching local use.

`/health` and `/liveness` stay the current JSON and do not receive a database handle.

`index.js` passes the existing TypeORM `DataSource` as an optional field on the object `createApp` already accepts (`createApp(dependencies = {})`). Do not add a new required argument. Existing route tests construct `createApp` with a partial object and no data source; those call sites stay unchanged. `/readiness` calls `dataSource.query('SELECT 1')` only when the field is present. Success: `200` `{ status: 'ready' }`. Failure or a missing data source: `503` `{ status: 'not_ready' }`. Log the driver error server-side; do not put it in the body. Docker healthchecks keep calling `/health`, so a database blip does not restart the container. Orchestrators that should stop traffic use `/readiness`.

### 5. Named volumes, not a new store

`docker-compose.backend.yml` and `docker-compose.qa.yml` gain named volumes for:

- `/app/public/avatars`
- `/app/public/feedback-photos`
- `/app/public/pet-photos`
- `/app/data/ups-labels`

The GeoIP mount stays `./data:/app/data:ro`. The intended label path is a nested volume at `/app/data/ups-labels`. Listing that mount after the read-only parent in the YAML is not evidence that Docker will allow the write. The acceptance test is a write inside the running container. If that write fails, move `UPS_LABEL_DIR` to `/app/ups-labels` and mount the volume there. The default in env stays `./data/ups-labels` until that fallback is taken.

Bind mounts of `./public/...` from the host are replaced by those volumes so a recreated container does not depend on the working tree. Existing QA files on the host must be copied into the volumes once, called out in the checklist.

Static routes in `app.js` stay. `LocalUpsLabelStorage` is not exposed as static files.

### 6. Checklist is a doc, Caddy apex stays until hostnames exist

Add `docs/production-go-live.md`. It lists the variables already in `.env.example` and `.env.qa.example`, the webhook paths that exist (`/stripe/v1/webhook/us`, `/stripe/v1/webhook/br`, and the legacy `/stripe/v1/webhook` alias registered as US), and the current Caddy map. It tells the operator to copy the `qa.edenbowls.com` `reverse_proxy` block onto `edenbowls.com` and `edenbowls.com.br` at cutover, and to add API and admin site blocks only for hostnames they have chosen, then put those exact origins in `CORS_ORIGINS`, `JWT_AUTH_ISSUER`, `STORE_APP_URL`, and `ADMIN_APP_URL`.

It records the store mismatch: `eden-bowls/src/features/region-experience/constants/domains.ts` uses `https://www.edenbowls.com` and `https://www.edenbowls.com.br`, while this repo's Caddy redirects `www` to the apex. Fixing that constant is a change in `eden-bowls`, outside this apply root. Store and admin production images are rebuilt from existing `VITE_*` (`VITE_QA_DEPLOY` must be false, `VITE_SITE_URL` must be the apex, `VITE_API_BASE_URL` must be the chosen API origin, Stripe publishable keys per market). This change does not add those variables; they already exist.

Rollback in the checklist is `mysqldump` of `DB_NAME` before `npm run migrate`, then restore that dump and redeploy the previous image. Do not add `migrate:revert`. The flavor seed migration's `down` is a no-op, so `undoLastMigration` is not a safe production rollback.

## Risks / Trade-offs

- [QA VPS uses `NODE_ENV=production` and `JWT_AUTH_SECRET_KEY=change-this-in-production`] → Filling real secrets is required before the next QA deploy. Document it at the top of the checklist and in `.env.qa.example`.
- [QA has no `UPS_*` lines in `.env.qa.example`] → After the schema starts reading them, an unset `UPS_ENV` fails production boot. The example must set `UPS_ENV=cie` for QA and the checklist must set `production` only for go-live.
- [SameSite=None on a shared API is required for `.com.br` callers] → QA does not need it. A mistaken `none` without `Secure` is already rejected.
- [Nested volume on a read-only parent] → Verify with a container write to `/app/data/ups-labels` during apply. If the engine rejects the nested mount, move `UPS_LABEL_DIR` to `/app/ups-labels` and mount the volume there instead. Do not remount all of `./data` read-write.
- [Replacing host bind mounts drops files that exist only on the QA disk] → Checklist step copies `public/avatars`, `public/feedback-photos`, `public/pet-photos`, and any labels into the volumes before the old mounts are removed.
- [Apex cutover is manual] → Shipping this change does not point `edenbowls.com` at the SPA. That is intentional until the API origin is chosen.
- [Store still links to `www`] → Caddy's 301 hides it for browsers, but region redirects will hop through `www`. Called out as a dependency on `eden-bowls`, not fixed here.
- [`/metrics` 404s for anyone without the token, including a scraper aimed at the public API host] → The checklist says to scrape from the private network with the bearer token. Do not publish `/metrics` on the public Caddy site.
- [`crypto.timingSafeEqual` throws when the buffers differ in length] → Compare SHA-256 digests, which are always 32 bytes. A wrong-length bearer token is a 404, not a 500.

## Migration Plan

1. Fill production secrets in the environment. Do not commit them. Update the examples with empty values and comments, including `UPS_*` and `METRICS_TOKEN` on the QA example.
2. Deploy the API image. `parseEnv` will refuse to listen until the guard passes.
3. Copy existing photo and label files into the new volumes, then recreate the API container with the volume mounts.
4. `mysqldump` the database. Run `npm run migrate` only if this deploy also needs schema changes. This change adds no migration.
5. Point readiness checks at `GET /readiness`. Leave Docker `healthcheck` on `GET /health`.
6. Cut over `edenbowls.com` and `edenbowls.com.br` only after the checklist hostnames, CORS, cookie `SameSite`, and store `VITE_*` rebuild agree.
7. Rollback of the process: previous image and the previous env file. Rollback of the database: restore the dump. Do not rely on migration `down`.

## Open Questions

None. Production API and admin hostnames are deliberately unset until the operator writes them into the checklist and Caddy together.
