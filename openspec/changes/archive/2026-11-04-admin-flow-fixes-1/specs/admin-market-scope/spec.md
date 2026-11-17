# Spec Delta

## ADDED Requirements

### Requirement: Admin identity reports effective markets

`GET /api/v1/admin/me` MUST also return `effectiveMarkets`: the markets the admin API scope applies to the caller on that request. It MUST be both markets for an admin, the stored markets for staff with stored markets, both markets for staff without stored markets while `ADMIN_ENFORCE_STAFF_MARKET` is off, and an empty array for them while it is on. `markets` MUST keep its current value.

#### Scenario: Operator without a stored market, flag off

- **WHEN** an operator with no stored market calls `GET /api/v1/admin/me` and `ADMIN_ENFORCE_STAFF_MARKET` is unset
- **THEN** the response has `markets: []` and `effectiveMarkets: ["BR", "US"]`

#### Scenario: Operator without a stored market, flag on

- **WHEN** the same operator calls `GET /api/v1/admin/me` with `ADMIN_ENFORCE_STAFF_MARKET=true`
- **THEN** the response is `200` with `markets: []` and `effectiveMarkets: []`

#### Scenario: Operator assigned BR

- **WHEN** an operator assigned `BR` calls `GET /api/v1/admin/me`
- **THEN** the response has `markets: ["BR"]` and `effectiveMarkets: ["BR"]`
