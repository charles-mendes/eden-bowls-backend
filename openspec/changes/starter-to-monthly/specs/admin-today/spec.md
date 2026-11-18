# Spec Delta

## ADDED Requirements

### Requirement: Today flags Starters with an unconfirmed delivery

`GET /api/v1/admin/today` MUST carry, in its `fulfillment` block, `startersUnconfirmed` with `BR` and `US` entries: the Starters whose invite was sent from an expected Day 1 and whose delivery is still not confirmed, within the actor's market scope. The item list MUST include each such Starter with the customer, the expected date, and the shipment or courier delivery to check. A Starter MUST leave the count when its delivery is confirmed. Counts for a market outside the actor's scope MUST be 0.

#### Scenario: Courier did not mark the delivery

- **WHEN** a BR Starter's invite went out from its expected date and the courier delivery is still `out_for_delivery`
- **THEN** a Brazil operator's Today counts 1 in `startersUnconfirmed.BR` and lists that Starter with its courier delivery

#### Scenario: Delivery confirmed later

- **WHEN** the courier then marks that delivery delivered
- **THEN** the count goes back to 0
