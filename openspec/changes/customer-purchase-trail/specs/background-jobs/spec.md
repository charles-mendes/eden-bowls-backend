# Spec Delta

## ADDED Requirements

### Requirement: Old purchase trail rows are deleted

Purchase trail retention MUST be its own scheduled job, with its own lock. It MUST run every 24 hours and MUST delete `customer_purchase_attempts` (with their events), orphan `customer_purchase_events` and `customer_purchase_config_events` older than 180 days, for both markets with the same cutoff. It MUST delete in bounded batches and MUST be idempotent.

#### Scenario: Old rows of both markets are removed

- **WHEN** the daily tick runs and a BR and a US attempt started 181 days ago
- **THEN** both attempts and their events are deleted

#### Scenario: Recent row remains

- **WHEN** an attempt started 179 days ago
- **THEN** the daily tick leaves it in place
