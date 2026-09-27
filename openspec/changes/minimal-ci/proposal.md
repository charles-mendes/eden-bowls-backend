# Proposal

## Why

Pull requests to `eden-bowls-backend` can merge with no automated check. The only GitHub Actions workflow here is `copilot-setup-steps`. Jest already covers the API with in-memory tests, and two MySQL integration files stay skipped unless `RUN_DB_INTEGRATION_TESTS=true`. Nothing in CI runs either path, and nothing checks that `parseEnv()` accepts a non-secret placeholder configuration.

## What Changes

- Add one GitHub Actions workflow on pull requests, pushes to `main`, and manual dispatch.
- Required jobs: Jest unit (`npm test`, integration files self-skip), then a MySQL 8.4 integration job (`npm run test:integration`) that starts only after unit tests pass, then a config check that loads `parseEnv()` with placeholder values and does not print them.
- Do not run `npm run migrate` in this pipeline. Migration seeds still query WordPress tables (`wp_posts` and related). An empty MySQL service is not a safe target.
- Do not add Playwright or ESLint. This repository has neither.
- Leave `copilot-setup-steps.yml` in place.
- Matching `minimal-ci` changes in `eden-bowls` and `eden-bowls-admin` cover those repositories. This change does not edit them.

## Capabilities

### New Capabilities

- `delivery/continuous-integration`: A backend pull request is validated by Jest unit tests, opt-in MySQL integration tests against an ephemeral database, and a secret-free config parse.

### Modified Capabilities

- None. `admin-market-scope` does not define CI behavior.

## Impact

- New workflow file under `.github/workflows/` in `eden-bowls-backend` only.
- Node 20, matching `Dockerfile`. MySQL 8.4 as a GitHub Actions service, aligned with `docker-compose.yml`, using the integration test's own env vars (`INTEGRATION_DB_*`) and throwaway credentials.
- No production database, no Stripe keys, no SMTP passwords, no GeoLite license key.
- Required check names are the approval gate. Branch protection stays a repository setting.
