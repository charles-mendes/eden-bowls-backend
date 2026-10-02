# Spec Delta

## Purpose

Validates a backend change with the existing Jest unit suite, the opt-in MySQL integration suite, and a secret-free configuration parse before that change is treated as ready to merge.

## ADDED Requirements

### Requirement: Backend changes are validated automatically
The repository MUST run continuous integration on every pull request, on every push to `main`, and when a person starts the workflow manually. The workflow MUST NOT replace the existing Copilot setup workflow.

#### Scenario: Pull request opened
- **WHEN** a pull request is opened or updated against this repository
- **THEN** the backend validation workflow starts without a manual step

#### Scenario: Push to main
- **WHEN** a commit is pushed to `main`
- **THEN** the same required checks run

#### Scenario: Manual run
- **WHEN** a person dispatches the workflow
- **THEN** the same required checks run

### Requirement: The unit check runs without a database
The check named `unit` MUST run the existing Jest suite without setting `RUN_DB_INTEGRATION_TESTS`. Integration files MUST remain skipped on that check. `unit` MUST NOT require MySQL, Stripe, SMTP, or a GeoIP license.

#### Scenario: Unit check does not open MySQL
- **WHEN** the `unit` check runs
- **THEN** Jest executes and the MySQL integration cases are skipped

#### Scenario: Unit failure stops the database check
- **WHEN** the `unit` check fails
- **THEN** the workflow result is failure and the `integration` check does not start

### Requirement: The integration check uses an ephemeral MySQL and executes its cases
After `unit` succeeds, the check named `integration` MUST run the existing integration script against a new MySQL 8.4 database created for that run. That script sets `RUN_DB_INTEGRATION_TESTS`; the workflow MUST NOT set it a second time. Credentials MUST be throwaway values supplied by the workflow, not production secrets. The workflow MUST NOT run database migrations and MUST NOT connect to a shared or production database. `integration` MUST fail when Jest skips the integration cases or reports zero passed tests.

#### Scenario: Integration runs only after unit success
- **WHEN** the `unit` check succeeds
- **THEN** `integration` starts against the ephemeral MySQL, the integration cases execute instead of being skipped, and the check is required for workflow success

#### Scenario: Skipped integration cases fail the check
- **WHEN** the integration script finishes with every integration case skipped, or with zero passed tests
- **THEN** the `integration` check fails

#### Scenario: Migrations stay out of CI
- **WHEN** any check runs
- **THEN** `npm run migrate` is not executed

### Requirement: The config check parses production rules without exposing secrets
The check named `config` MUST install dependencies, then load the environment parser with `NODE_ENV=production` and synthetic non-placeholder values. It MUST succeed only when that parse succeeds. The check MUST NOT print the parsed configuration or the process environment, MUST NOT enable shell tracing, and MUST NOT read production secrets. A production parse that the parser rejects MUST fail the check.

#### Scenario: Production placeholder config parses
- **WHEN** `config` runs with synthetic production values the parser accepts
- **THEN** the parser accepts them and the log does not contain those values

#### Scenario: Rejected production placeholder fails the check
- **WHEN** the production placeholder set is one the parser rejects
- **THEN** the workflow result is failure
