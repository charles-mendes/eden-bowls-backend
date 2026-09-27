# Tasks

## 1. Production env guard

- [x] 1.1 Add `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`, `UPS_ENV`, `UPS_HTTP_TIMEOUT_MS`, `UPS_TRANSACTION_SRC`, `UPS_LABEL_DIR`, and `METRICS_TOKEN` to `rawEnvSchema` in `src/config/env.js`. Verify with a one-off `parseEnv({ NODE_ENV: 'development', UPS_ENV: 'production', UPS_CLIENT_ID: 'abc' })` that `UPS_ENV` stays `production` and the client id is kept.
- [x] 1.2 In `parseEnv`, when `NODE_ENV` is `production`, throw before return if JWT, OTP pepper, SMTP host, SMTP from, Stripe US secret, Stripe US webhook secret, Stripe BR secret, Stripe BR webhook secret, UPS credentials, `METRICS_TOKEN`, or `DB_PASSWORD` is blank or equal to `change-this-in-production` or `hsr-default-salt`. Require `STRIPE_BR_ENABLED` to be present and exactly `true` or `false` after trim, case-insensitive. `1`, `yes`, and `on` must throw in production even though `toBoolean` would accept them. Require `JWT_AUTH_ISSUER` to be `https` and not `localhost`. Require `UPS_ENV` to be `production` or `cie` with no silent `cie` default. Verify `NODE_ENV=development` still returns the current defaults when those keys are absent.
- [x] 1.3 Reject production boot when `AUTH_REFRESH_COOKIE_DOMAIN` is non-empty, when `CORS_ORIGINS` contains `http://` or `localhost`, and when the allow-list includes both an `edenbowls.com` host and an `edenbowls.com.br` host while `AUTH_REFRESH_COOKIE_SAME_SITE` is not `none`. Leave the existing `Secure` and `SameSite=none` throws in place. Verify a production env whose CORS list is only `https://qa.edenbowls.com,https://qa-admin.edenbowls.com` still accepts `lax`.

## 2. Probes and metrics

- [x] 2.1 Pass the existing TypeORM `DataSource` from `src/index.js` as an optional field on the object `createApp` already accepts. Do not add a required argument and do not edit existing `createApp({ ... })` call sites in `tests/`. `GET /readiness` runs `SELECT 1` when the field is present, returns `200` `{ status: 'ready' }` on success, and `503` `{ status: 'not_ready' }` on failure or a missing data source, with no driver text in the body. Verify `/health` and `/liveness` still return `200` without calling `query`. Verify `npx jest --runTestsByPath tests/breeds.routes.test.js` still passes with `createApp` called without a data source.
- [x] 2.2 In production, `GET /metrics` returns `404` with an empty body unless `Authorization` is `Bearer` plus `METRICS_TOKEN`. Compare SHA-256 digests with `crypto.timingSafeEqual`, not the raw strings, so a different length does not throw. Outside production, keep the current Prometheus body. Verify a missing token, a wrong token, and a shorter token all return `404` rather than `500`, and that the correct token returns Prometheus text.
- [x] 2.3 Leave Docker `healthcheck` commands in `docker-compose.backend.yml` and `docker-compose.qa.yml` pointed at `GET /health`. Verify the compose files still contain that URL.

## 3. Persistent files

- [x] 3.1 In `docker-compose.backend.yml` and `docker-compose.qa.yml`, replace the `./public/avatars`, `./public/feedback-photos`, and `./public/pet-photos` host binds with named volumes at `/app/public/avatars`, `/app/public/feedback-photos`, and `/app/public/pet-photos`. Add a named volume at `/app/data/ups-labels`. Keep `./data:/app/data:ro`. Verify the four volume entries and the read-only `./data` mount are present. YAML order is not evidence that a nested volume is writable; that check is task 3.2.
- [x] 3.2 Start the API container from `docker-compose.backend.yml` and write a file in the UPS label directory. That write is the acceptance of the mount. If the nested path rejects the write because the parent is read-only, switch the label volume to `/app/ups-labels`, set compose `UPS_LABEL_DIR` to that path, and repeat the write. Verify the write succeeds and `GET /api/v1/admin/shipments/:id/label` is unchanged.
- [x] 3.3 Do not add an object-storage client. Verify `package.json` dependencies are unchanged aside from no new storage SDK.

## 4. Examples and go-live checklist

- [x] 4.1 Update `.env.example` and `.env.qa.example` comments so production rejects blank secrets, `change-this-in-production`, and `hsr-default-salt`. Add `UPS_*` and `METRICS_TOKEN` to `.env.qa.example` with `UPS_ENV=cie`. Do not put real secrets in the files. Verify `UPS_ENV=cie` is present in the QA example and `METRICS_TOKEN` is an empty assignment.
- [x] 4.2 Add `docs/production-go-live.md` covering env vars, `edenbowls.com` and `edenbowls.com.br` (static landing today, `www` redirects to apex), CORS, Stripe webhook paths `/stripe/v1/webhook/us` and `/stripe/v1/webhook/br`, UPS (`cie` vs `production`), SMTP, MySQL, `npm run migrate`, a `mysqldump` taken before migrate, and rollback by restoring that dump. State that production API and admin hostnames are not in `infra/caddy/Caddyfile`. State that `eden-bowls` `DOMAIN_COM_URL` is `https://www.edenbowls.com` and `DOMAIN_COMBR_URL` is `https://www.edenbowls.com.br`. Include the one-time copy of existing `public/avatars`, `public/feedback-photos`, `public/pet-photos`, and labels into the new volumes. Verify the doc does not name an API or admin host that is absent from the Caddyfile.
- [x] 4.3 Do not edit `infra/caddy/Caddyfile` apex blocks in this change. Verify `edenbowls.com` and `edenbowls.com.br` still `file_server` from `/srv/edenbowls`.

## 5. Tests

- [x] 5.1 Add `tests/env.parse.test.js` for the production throws, the development defaults, UPS passthrough, cookie domain, the two-TLD `SameSite` rule, and `STRIPE_BR_ENABLED` values `true`, `false`, `1`, and `yes`. Run `npx jest --runTestsByPath tests/env.parse.test.js` and verify it passes.
- [x] 5.2 Add route coverage for `/readiness` success, failure, and a missing data source, and for `/metrics` with the correct token, a wrong token, and a shorter token. Run only that new test file with `npx jest --runTestsByPath` and verify it passes.
