## ADDED Requirements

### Requirement: Plan settings are stored once per market

Each market (BR, US) MUST have one plan settings record with plan days and large-pack limit. Plan days MUST be an integer greater than zero (a decimal such as 28.5 is invalid); anything else MUST be refused with HTTP 422 `plan_days_invalid`. The large-pack limit MUST be an integer from 1 to 60; anything else MUST be refused with HTTP 422 `large_pack_limit_invalid`. A refused save MUST leave the stored record unchanged.

#### Scenario: Save valid settings

- **WHEN** an operator saves BR plan settings with plan days 28 and large-pack limit 6
- **THEN** the BR record holds 28 and 6 and the US record is unchanged

#### Scenario: Decimal plan days

- **WHEN** an operator saves BR plan settings with plan days 28.5
- **THEN** the API returns 422 `plan_days_invalid` and the BR record is unchanged

#### Scenario: Limit out of range

- **WHEN** an operator saves US plan settings with large-pack limit 0
- **THEN** the API returns 422 `large_pack_limit_invalid` and the US record is unchanged

### Requirement: Admin reads and saves plan settings of one market

`GET /api/v1/admin/catalog/plan-settings?market=BR|US` MUST return `market`, `planDays` and `largePackLimit`, and require `catalog.read`. `PUT` on the same path MUST save `planDays` and `largePackLimit` and require `catalog.write`. Both MUST be limited to the session's markets, and a missing or unknown market MUST answer 400. Every save that changes a value MUST be recorded in the admin audit log with the market and the previous and new values.

#### Scenario: Read-only session cannot save

- **WHEN** a session with only `catalog.read` saves BR plan settings
- **THEN** the API returns 403 and the record is unchanged

#### Scenario: Session outside the market

- **WHEN** a session limited to BR reads the US plan settings
- **THEN** the API returns 403

### Requirement: Deploy keeps the current plan values

The deploy MUST create the record of each market with the plan days and large-pack limit of the market's first published product (by menu order, then id), the product the recommendation reads before the deploy. A market whose product has no large-pack limit MUST get 8. A market with no published product, or whose product has no plan days or a value that is not a positive integer, MUST get 30 plan days, the value the recommendation used for it. A record already present MUST be kept.

#### Scenario: Values copied from the plan product

- **WHEN** the migration runs and the BR plan product has plan days 30 and large-pack limit 8
- **THEN** the BR plan settings hold 30 and 8, and a 20 kg adult dog gets the same recommendation as before the deploy

### Requirement: Products no longer carry plan settings

Product create and PATCH MUST ignore `planDays` and `largePackLimit`, and the product detail MUST NOT return them. Creating a product MUST NOT require plan days, and publishing a product MUST require only its market.

#### Scenario: Create a product without plan days

- **WHEN** an operator creates a BR product with a name and no plan days
- **THEN** the product is created as a draft

#### Scenario: Plan days sent to a product are ignored

- **WHEN** an operator PATCHes a BR product with `planDays` 15
- **THEN** the BR plan settings keep their plan days and the response has no `planDays`

### Requirement: Store catalog reports the market's plan days

`GET /api/v1/products` MUST keep the `days` field of each product and fill it with the plan days of the product's market.

#### Scenario: Store reads plan days

- **WHEN** BR plan settings have plan days 28 and the store lists the BR catalog
- **THEN** every BR product in the response has `days` 28
