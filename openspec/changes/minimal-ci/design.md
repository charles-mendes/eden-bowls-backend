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

`permissions: contents: read`. Node 20. `npm ci`. No `pull_request_target`. Concurrency group per ref, cancel in progress.

### Jobs

```
pull_request | push main | workflow_dispatch
        |
        +-- unit      npm test
        |     |
        |     +-- integration   needs: unit
        |
        +-- config    parseEnv() with placeholders
```

`unit` does not set `RUN_DB_INTEGRATION_TESTS`, so the integration files skip. It has no service container.

`integration` declares `needs: [unit]`. It adds a MySQL 8.4 service with a health check, creates the database via the image's own env (`MYSQL_DATABASE`, `MYSQL_ROOT_PASSWORD`), and publishes port 3306 to the job. The job then exports only:

- `RUN_DB_INTEGRATION_TESTS=true`
- `INTEGRATION_DB_HOST=127.0.0.1`
- `INTEGRATION_DB_PORT=3306`
- `INTEGRATION_DB_USER` / `INTEGRATION_DB_PASSWORD` / `INTEGRATION_DB_NAME` as fixed CI literals (for example user `root`, password `ci`, database `eden_bowls`)

Those literals are not GitHub secrets and must not be echoed. Then `npm run test:integration`.

`config` has no `needs`. It runs `node -e` that requires `parseEnv` and exits 0 or 1. The placeholder env is a workflow `env:` block: `NODE_ENV=test`, a dummy `JWT_AUTH_SECRET_KEY`, and dummy `DB_*` that are never connected. The script must not `console.log` the result. Do not pass Stripe, SMTP, or UPS values; the schema marks them optional.

Alternative considered: run migrate, then integration, on the service database. Rejected because current migrations assume WordPress tables. The integration tests do not call the migration runner.

Alternative considered: fold config into `unit`. Rejected so a Zod failure is visible as its own check and does not wait on the full Jest run.

### Approval and failure

Success means `unit`, `integration`, and `config` are green. `integration` is skipped by Actions only when `unit` fails; that skip is a failed workflow, not a pass. No `continue-on-error`. No extra Jest retry. No artifact upload: these jobs produce logs, not browser traces.

## Risks / Trade-offs

- [Integration tests create ad hoc tables and still assume a reachable MySQL] → Service health check before Jest. They do not need the app schema.
- [A future migration that the integration tests start to require will not be covered] → Out of scope until seeds no longer touch `wp_*`. Called out so nobody adds `npm run migrate` to this workflow as a drive-by.
- [`npm test` and `npm run test:unit` are the same command] → CI calls `npm test` only. No second unit job.
- [Dummy JWT and DB password appear in the workflow file] → They are placeholders, not production secrets. The config step still must not print them.

## Migration Plan

Add the workflow on a pull request. After a green run on `main`, require the three check names in branch protection. Rollback is deleting the workflow file.

## Open Questions

None that change the job graph. Whether to later add a migrate smoke test depends on decoupling seeds from WordPress, which is a different change.
