# Spec Delta

## Purpose

Covers the per-market shipping settings that operators edit in the admin and that the API applies to quotes and delivery estimates without a deploy.

## ADDED Requirements

### Requirement: US maximum transit days is an editable setting

The US shipping settings MUST hold `max_transit_days`, an integer from 1 to 10, set to 1 on deploy. `GET /api/v1/admin/shipping/settings` MUST return it and `PUT /api/v1/admin/shipping/settings` MUST accept it with `shipping.write`; a value outside the range MUST be refused with HTTP 422 and the stored settings MUST stay unchanged. The delivery estimate, the delivery calendar impact and the customer deliveries MUST treat a US transit longer than the stored value as unavailable, in place of the fixed limit. A saved value MUST apply without restarting the API.

#### Scenario: Value after deploy

- **WHEN** the migration runs and a client requests a US delivery estimate with `transit_days=2`
- **THEN** the estimate is `available: false`, as before the deploy

#### Scenario: Operator allows two transit days

- **WHEN** an operator saves `max_transit_days` 2 and a client then requests a US estimate with `transit_days=2`
- **THEN** the estimate is available with its preparation day and delivery date

#### Scenario: Out of range

- **WHEN** an operator saves `max_transit_days` 0
- **THEN** the API returns 422 and the stored value is unchanged
