# Proposal

## Why

`NODE_ENV=production` already boots the API with empty secrets, a hardcoded OTP pepper, Stripe and SMTP left optional, and UPS credentials dropped by env parsing so the client always stays on the CIE sandbox. `/readiness` reports ready without querying MySQL, and `/metrics` is anonymous on the same port Caddy publishes. The apex domains still serve the static landing, not the store.

## What Changes

- **BREAKING:** when `NODE_ENV=production`, the process MUST refuse to start if JWT, OTP pepper, SMTP, Stripe US, Stripe BR, UPS credentials, the metrics token, or the database password are missing or still the known local placeholders. Development and test keep today's defaults.
- Honor `UPS_*` from the environment. Today `parseEnv` reads those fields after Zod strips them, so `UPS_ENV=production` is ignored and the client stays on `cie`.
- Keep the refresh cookie `HttpOnly`. In production it stays `Secure` and host-only (no `Domain`). A CORS list that includes both `edenbowls.com` and `edenbowls.com.br` MUST use `SameSite=None`.
- Stop serving anonymous Prometheus output in production. `/health` and `/liveness` stay process-only. `/readiness` MUST run `SELECT 1` on the existing TypeORM `DataSource` and return 503 when MySQL is down, without leaking the error.
- Persist avatars, pet photos, feedback photos, and UPS labels on named Docker volumes, the same mechanism already used for MySQL. Do not add an object store. Take label writes off the read-only `./data` mount.
- Add a go-live checklist for env, the two store domains, CORS, Stripe, UPS, SMTP, MySQL, `npm run migrate`, and rollback by restoring a dump. TypeORM `down()` already exists; there is no revert script.

Out of scope: WordPress removal, dropping `wp_*` tables, CI/CD, password reset, workers, and new business features.

## Capabilities

### New Capabilities

- `production-readiness`: production boot checks, cookie and CORS rules, probe and metrics exposure, local file persistence, and the go-live checklist.

### Modified Capabilities

- None. `admin-market-scope` and `catalog-product-delete` do not define boot, probes, cookies, or file storage.

## Impact

- Edited: `src/config/env.js`, `src/app.js`, `src/index.js`, `docker-compose.backend.yml`, `docker-compose.qa.yml`, `.env.example`, `.env.qa.example`, and a new `docs/production-go-live.md`.
- Referenced only, not edited: `src/scripts/run-migrations.js` and the `package.json` scripts. The checklist names `npm run migrate`. This change adds no migration and no `migrate:revert` script.
- `infra/caddy/Caddyfile` is read to describe the apex hosts that serve `/srv/edenbowls`. The apex blocks stay as they are.
- Store and admin stay separate repos. Their production build is configuration of existing `VITE_*` variables, plus one store constant that still points at `www` while Caddy redirects `www` to the apex. That constant is a dependency, not a behavior this backend change can edit.
- QA already sets `NODE_ENV=production`. The new guard applies to that VPS as well. `UPS_ENV=cie` remains valid there; silent fallback to CIE does not.
