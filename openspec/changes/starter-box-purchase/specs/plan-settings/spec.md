# Spec Delta

## ADDED Requirements

### Requirement: Plan settings hold the Starter days and discount

Each market's plan settings MUST hold the Starter days, an integer from 1 to 30, and the Starter discount percent, an integer from 1 to 90. The deploy MUST store 10 days and 40 percent in both markets. The admin plan settings read and save MUST include both, with `catalog.write` to save, as today. A Starter days value outside the range MUST be refused with HTTP 422 `starter_days_invalid`, and a percent outside the range with 422 `starter_discount_percent_invalid`. A refused save MUST leave the stored record unchanged. The plan snapshot Starter offer and the Starter checkout MUST read the stored values of the market.

#### Scenario: Values after deploy

- **WHEN** the migration runs
- **THEN** BR and US plan settings have 10 Starter days and 40 percent, and the other plan settings are unchanged

#### Scenario: Operator changes the US percent

- **WHEN** an operator saves US plan settings with a Starter discount of 35
- **THEN** new US Starter checkouts get 35 percent off the food, and BR keeps 40

#### Scenario: Days out of range

- **WHEN** an operator saves BR plan settings with 0 Starter days
- **THEN** the API returns 422 `starter_days_invalid` and the BR record is unchanged
