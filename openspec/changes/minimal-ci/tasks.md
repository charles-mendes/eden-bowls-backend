# Tasks

## 1. Workflow skeleton

- [ ] 1.1 Add `.github/workflows/ci.yml` with `pull_request`, `push` to `main`, and `workflow_dispatch`, `permissions: contents: read`, and a concurrency group that cancels in-progress runs for the same ref. Verify the file is valid YAML, those three triggers are present, and `.github/workflows/copilot-setup-steps.yml` is unchanged.

## 2. Unit and config checks

- [ ] 2.1 Add job `unit` that uses Node 20, runs `npm ci`, then `npm test`, does not set `RUN_DB_INTEGRATION_TESTS`, and has no service container. Verify the job name is `unit` and the env var is absent.
- [ ] 2.2 Add job `config` with no `needs`. It sets placeholder `NODE_ENV`, `JWT_AUTH_SECRET_KEY`, and `DB_*` values and runs a Node command that calls `parseEnv()` and does not print the result or `process.env`. Verify the workflow has no `secrets.` context and no Stripe, SMTP, or UPS values.

## 3. MySQL integration

- [ ] 3.1 Add job `integration` with `needs: [unit]`, a `mysql:8.4` service with a health check, and throwaway `INTEGRATION_DB_*` credentials plus `RUN_DB_INTEGRATION_TESTS=true`. The job runs `npm run test:integration` and does not run `npm run migrate`. Verify `needs` lists only `unit` and the migrate script is absent from the file.

## 4. Change check

- [ ] 4.1 Run `openspec validate --change minimal-ci` and verify it exits 0. The first execution of unit, integration, and config happens when the workflow file is opened as a pull request.
