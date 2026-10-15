# Tasks

## 1. Workflow skeleton

- [x] 1.1 Add `.github/workflows/ci.yml` with `pull_request`, `push` to `main`, and `workflow_dispatch`, `permissions: contents: read`, `timeout-minutes: 20` on every job, and a concurrency group that cancels in-progress runs only when `github.event_name == 'pull_request'`. Verify the file is valid YAML, those three triggers are present, `main` pushes are not cancelled, and `.github/workflows/copilot-setup-steps.yml` is unchanged.

## 2. Unit and config checks

- [x] 2.1 Add job `unit` that uses Node 20, runs `npm ci`, then `npm test`, does not set `RUN_DB_INTEGRATION_TESTS`, and has no service container. Verify the job name is `unit` and the env var is absent.
- [x] 2.2 Add job `config` with no `needs`. It uses Node 20, runs `npm ci`, sets `NODE_ENV=production` plus synthetic non-placeholder secrets (including Stripe, SMTP, UPS, and metrics), and runs a Node command that calls `parseEnv()` with no `console.log`, no `echo`, and no `set -x`. Verify the workflow has no `secrets.` context. Locally, run the same command with `JWT_AUTH_SECRET_KEY=change-this-in-production` and verify it exits non-zero. Do not add that failing command as a CI step.

## 3. MySQL integration

- [x] 3.1 Add job `integration` with `needs: [unit]`, a `mysql:8.4` service with a health check, and throwaway `INTEGRATION_DB_*` credentials. Do not set `RUN_DB_INTEGRATION_TESTS` in the workflow; `npm run test:integration` already does. The job runs that script, writes a Jest JSON report, and fails unless passed tests are greater than zero and pending tests are zero. It does not run `npm run migrate`. Verify `needs` lists only `unit`, the migrate script is absent, and a report of only skipped tests would fail the step.

## 4. Change check

- [ ] 4.1 Run `openspec validate minimal-ci --type change` and verify it exits 0. The first execution of `unit`, `integration`, and `config` happens when the workflow file is opened as a pull request. On that run, confirm the `integration` log shows passed tests, not a fully skipped suite.
