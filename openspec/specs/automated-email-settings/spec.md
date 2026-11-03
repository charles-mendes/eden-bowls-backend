# automated-email-settings Specification

## Purpose
Lets operators pause or limit the automated life-stage emails per market from the admin, in place of environment variables that need an API restart.

## Requirements

### Requirement: Automated life-stage email settings per market

Each market MUST have `life_stage_change_enabled` (boolean), `announcement_batch_size` (integer from 1 to 500) and `announcement_daily_cap` (integer from 1 to 5,000, and not lower than the batch size). Reading MUST require `settings.read` and saving `settings.email.write` (admin and operator); an invalid value MUST be refused with HTTP 422 and the stored settings MUST stay unchanged. Saving MUST be recorded in the admin audit log as `settings.email.update`. The deploy MUST store the values the environment holds at migration time, with the current defaults (enabled, 50, 300) where a variable is unset. The environment variables MUST NOT be read after the deploy.

#### Scenario: Values after deploy

- **WHEN** the migration runs with `LIFE_STAGE_CHANGE_EMAIL_ENABLED_US=false` and no announcement variables set
- **THEN** US has the stage-change email disabled, BR has it enabled, and both have batch 50 and daily cap 300

#### Scenario: Pause without restart

- **WHEN** an operator disables the BR stage-change email and the job runs next
- **THEN** the job skips BR without any read or write for that market, and no process restart was needed

#### Scenario: Cap lower than batch

- **WHEN** an operator saves batch 100 and daily cap 50
- **THEN** the API returns 422 and the stored settings are unchanged

### Requirement: Plan notice settings per market

Each market MUST have `renewal_notice_enabled` (boolean), `plan_ending_notice_enabled` (boolean), and `plan_notice_days` (integer from 1 to 30). The deploy MUST store both switches on and 7 days. Reading, saving, validation, and the audit entry MUST follow the rules of the existing automated email settings, and saving MUST require all three fields.

#### Scenario: Values after deploy

- **WHEN** the migration runs
- **THEN** BR and US have both notices enabled and a 7-day window, and the life-stage values are unchanged

#### Scenario: Window out of range

- **WHEN** an operator saves `plan_notice_days` as 31
- **THEN** the API returns 422 listing that field and the stored settings are unchanged

#### Scenario: Save without the new fields

- **WHEN** a client saves only the life-stage fields
- **THEN** the API returns 422 listing the missing fields and the stored settings are unchanged

#### Scenario: Pause one notice without restart

- **WHEN** an operator disables the BR renewal notice and the job runs next
- **THEN** BR sends no renewal notice, BR still sends plan-ending notices, and no process restart was needed
