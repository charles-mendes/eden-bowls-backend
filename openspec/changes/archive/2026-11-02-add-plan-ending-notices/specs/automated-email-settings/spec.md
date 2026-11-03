# Spec Delta

## ADDED Requirements

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
