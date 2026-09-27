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

### Requirement: Unit tests run without a database
The workflow MUST run the existing Jest suite as a required check without setting `RUN_DB_INTEGRATION_TESTS`. Integration files MUST remain skipped on that check. The unit check MUST NOT require MySQL, Stripe, SMTP, or a GeoIP license.

#### Scenario: Unit check does not open MySQL
- **WHEN** the unit check runs
- **THEN** Jest executes and the MySQL integration cases are skipped

#### Scenario: Unit failure stops the database check
- **WHEN** the unit check fails
- **THEN** the workflow result is failure and the MySQL integration check does not start

### Requirement: Integration tests use an ephemeral MySQL
After the unit check succeeds, the workflow MUST run the existing integration script with `RUN_DB_INTEGRATION_TESTS=true` against a new MySQL 8.4 database created for that run. Credentials MUST be throwaway values supplied by the workflow, not production secrets. The workflow MUST NOT run database migrations. The workflow MUST NOT connect to a shared or production database.

#### Scenario: Integration runs only after unit success
- **WHEN** the unit check succeeds
- **THEN** the integration check starts against the ephemeral MySQL and is required for workflow success

#### Scenario: Migrations stay out of CI
- **WHEN** either check runs
- **THEN** `npm run migrate` is not executed

### Requirement: Configuration is parsed without exposing secrets
The workflow MUST load the environment parser with placeholder values and MUST succeed only when that parse succeeds. The check MUST NOT print the parsed configuration or the process environment, and MUST NOT read production secrets.

#### Scenario: Placeholder config parses
- **WHEN** the config check runs with CI placeholder values
- **THEN** the parser accepts them and the log does not contain those values

#### Scenario: Invalid placeholder config fails the check
- **WHEN** the placeholder set is rejected by the parser
- **THEN** the workflow result is failure
