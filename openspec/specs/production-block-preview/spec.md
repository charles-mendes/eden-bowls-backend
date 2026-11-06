# production-block-preview Specification

## Purpose

Lets the operator see, before blocking a production cycle, what the block does to its charge.

## Requirements

### Requirement: The block preview says where the charge goes

`GET /api/v1/admin/production/queue/:id/block-preview?periodEnd=…` MUST answer, for the cycle of subscription `:id` that ends at `periodEnd`, what blocking it would do to the charge, using the same rule as the block itself and without changing anything in Stripe or in the database. It requires `production.write` and the subscription's market in the actor's scope.

The answer MUST carry `charged` (true when the cycle is already paid), `chargeMovesTo` (the instant the block moves the charge to, or null when it does not move it) and `preparationDay` (the civil preparation day that charge serves, or null). A paid cycle answers `charged: true` with both dates null.

An unknown subscription MUST answer `404`. A `periodEnd` that is not the subscription's current unpaid cycle nor a paid cycle MUST answer `409 production_period_stale`, as the status change does.

#### Scenario: Unpaid cycle

- **WHEN** the operator previews the block of a cycle awaiting payment
- **THEN** the answer has `charged: false`, `chargeMovesTo` at midnight, in the market's timezone, of the first valid preparation day from the cycle's `periodEnd` plus one month (the delivery calendar may skip invalid days), and that `preparationDay`

#### Scenario: Preview matches the block

- **WHEN** the operator previews the block of an unpaid cycle and then blocks it with no change in between
- **THEN** the charge moves to the `chargeMovesTo` of the preview

#### Scenario: Paid cycle

- **WHEN** the operator previews the block of a paid cycle
- **THEN** the answer has `charged: true`, `chargeMovesTo: null` and `preparationDay: null`

#### Scenario: Nothing changes

- **WHEN** the operator previews a block
- **THEN** the cycle keeps its status, and no Stripe call or audit entry is made

#### Scenario: Stale cycle

- **WHEN** the operator previews with a `periodEnd` that is no longer the cycle in the queue
- **THEN** the answer is `409 production_period_stale`

#### Scenario: Out of scope

- **WHEN** a Brazil operator previews a block for a `us` subscription
- **THEN** the request is refused as any record outside the actor's market
