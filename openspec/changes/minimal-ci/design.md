# Design

## Context

See proposal.md for why. `origin` is GitHub, the default branch is `main`, and the only workflow is `copilot-setup-steps.yml`. Scripts that already exist: `npm test` and `npm run test:unit` (both `jest --runInBand`), `npm run test:integration` (`RUN_DB_INTEGRATION_TESTS=true` and `tests/integration`), and `npm run migrate`. The two integration files skip themselves unless that env var is `true`. They open MySQL with `INTEGRATION_DB_HOST`, `INTEGRATION_DB_PORT`, `INTEGRATION_DB_USER`, `INTEGRATION_DB_PASSWORD`, and `INTEGRATION_DB_NAME`, and they create their own tables. `docker-compose.yml` uses `mysql:8.4`. `npm run migrate` is not safe on an empty database: flavor and feedback seeds query `wp_posts` and related WordPress tables. `parseEnv()` in `src/config/env.js` validates with Zod and does not connect to MySQL. `Dockerfile` uses Node 20. There is no ESLint and no Playwright.

## Goals / Non-Goals

**Goals:**

- One Actions workflow with the job dependency the spec requires: integration starts only after unit succeeds.
- Ephemeral MySQL 8.4, throwaway credentials, no migration run.
- A config parse that cannot leak values into the log.

**Non-Goals:**

- Running `npm run migrate`, seeding WordPress tables, or pointing CI at QA MySQL.
- Adding ESLint, Playwright, or a deploy job.
- Editing Jest config, `copilot-setup-steps.yml`, or the other repositories.
- Enabling branch protection from the workflow file.

## Decisions

### Platform and triggers

GitHub Actions, same reason as the storefront change: the remote is GitHub and Actions is already in `.github/workflows/`.

```
pull_request
push branches: [main]
workflow_dispatch
```

`permissions: contents: read`. Node 20. `npm ci`. No `pull_request_target`. One concurrency group per ref. `cancel-in-progress` is true only for `pull_request`, so a later push to `main` does not cancel the run of the previous commit. Each job sets `timeout-minutes: 20`. Action references stay on the same major tags the Copilot workflow already uses (`actions/checkout@v4`, `actions/setup-node@v4`); pinning SHAs is out of scope.

### Jobs

```
pull_request | push main | workflow_dispatch
        |
        +-- unit      npm test
        |     |
        |     +-- integration   needs: unit
        |
        +-- config    parseEnv() with NODE_ENV=production
```

`unit` does not set `RUN_DB_INTEGRATION_TESTS`, so the integration files skip. It has no service container.

`integration` declares `needs: [unit]`. It adds a MySQL 8.4 service with a health check, creates the database via the image's own env (`MYSQL_DATABASE`, `MYSQL_ROOT_PASSWORD`), and publishes port 3306 to the job. The job exports only `INTEGRATION_DB_HOST=127.0.0.1`, `INTEGRATION_DB_PORT=3306`, and throwaway `INTEGRATION_DB_USER` / `INTEGRATION_DB_PASSWORD` / `INTEGRATION_DB_NAME`. It does not also export `RUN_DB_INTEGRATION_TESTS`: `npm run test:integration` already sets that for the Jest process. Those literals are not GitHub secrets and must not be echoed.

Jest exits 0 when every integration case is skipped. After the script, the job reads the Jest JSON report and fails unless `numPassedTests` is greater than 0 and `numPendingTests` is 0. A green log that only says skipped is a failed check.

`config` has no `needs`. It uses `actions/setup-node` and `npm ci` before any `node -e`, because `parseEnv` loads Zod from `node_modules`. `NODE_ENV=test` does not run `assertProductionEnv` in `src/config/env.js`, and `JWT_AUTH_SECRET_KEY` is optional outside production, so omitting it would still pass. The job therefore uses `NODE_ENV=production` and synthetic values that are not the rejected literals `change-this-in-production` or `hsr-default-salt`, including the Stripe, SMTP, UPS, and metrics values that production mode requires. The command calls `parseEnv()` and does not `console.log` the result. The step must not use `set -x` or echo the environment. A local check, not a second CI job, confirms that `NODE_ENV=production` with `JWT_AUTH_SECRET_KEY=change-this-in-production` exits non-zero.

Alternative considered: run migrate, then integration, on the service database. Rejected because current migrations assume WordPress tables. The integration tests do not call the migration runner.

Alternative considered: fold config into `unit`. Rejected so a Zod failure is visible as its own check and does not wait on the full Jest run.

### Approval and failure

Success means `unit`, `integration`, and `config` are green. `integration` is skipped by Actions only when `unit` fails; that skip is a failed workflow, not a pass. No `continue-on-error`. No extra Jest retry. No artifact upload: these jobs produce logs, not browser traces.

## Risks / Trade-offs

- [Jest exits 0 when the integration suite is skipped] → The job fails unless the JSON report shows passed tests and zero pending tests.
- [Integration tests create ad hoc tables and still assume a reachable MySQL] → Service health check before Jest. They do not need the app schema.
- [A future migration that the integration tests start to require will not be covered] → Out of scope until seeds no longer touch `wp_*`. Called out so nobody adds `npm run migrate` to this workflow as a drive-by.
- [`npm test` and `npm run test:unit` are the same command] → CI calls `npm test` only. No second unit job.
- [Dummy JWT and DB password appear in the workflow file] → They are placeholders, not production secrets. The config step still must not print them.

## Migration Plan

Add the workflow on a pull request. After a green run on `main`, require the three check names in branch protection. Rollback is deleting the workflow file.

## Open Questions

None that change the job graph. Whether to later add a migrate smoke test depends on decoupling seeds from WordPress, which is a different change.
