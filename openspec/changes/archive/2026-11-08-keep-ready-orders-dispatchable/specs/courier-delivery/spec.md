## ADDED Requirements

### Requirement: The production queue keeps a ready Brazil order until it leaves

When overdue cycles are included, the production queue MUST list, besides the overdue cycles not `ready`, every paid cycle with production status `ready` whose preparation day is before today and no more than 30 days ago, whose shipping market is Brazil (`br` account and address in Brazil), and whose invoice has no courier delivery on the road, delivered or failed. The cycle MUST leave the queue once a delivery is registered for its invoice. A `ready` cycle of the US market or in market exception MUST NOT be kept this way. The queue's overdue metric MUST count only overdue cycles not `ready`; the `due=overdue` filter MUST list both.

#### Scenario: Late order marked ready

- **WHEN** an operator marks `ready` a paid Brazil cycle prepared 24 days ago with no courier delivery
- **THEN** it stays in the queue under overdue with production status `ready`, and the overdue metric no longer counts it

#### Scenario: Box left

- **WHEN** that cycle's invoice gets a delivery out for delivery
- **THEN** the cycle is no longer in the queue

#### Scenario: Past the floor

- **WHEN** a `ready` Brazil cycle with no delivery was prepared 31 days ago
- **THEN** it is not in the queue

#### Scenario: US order

- **WHEN** a paid US cycle prepared 3 days ago is `ready`
- **THEN** it is not in the queue

### Requirement: Queue items and the subscription detail show what the address lacks

Each production queue item MUST include `courierIssues`. On a cycle whose shipping market is Brazil it MUST be the codes the dispatch would refuse (as the courier queue's `issues`), empty when the address passes. On any other cycle it MUST be null. The subscription detail read by the panel MUST include `courier_issues` by the same rule for the subscription's address. Neither read MUST open an address problem or send an email.

#### Scenario: Ready order without a recipient name

- **WHEN** the production queue lists a `ready` Brazil cycle whose address has no recipient name
- **THEN** its `courierIssues` is `["recipient_name_missing"]`

#### Scenario: US cycle

- **WHEN** the production queue lists a US cycle
- **THEN** its `courierIssues` is null

#### Scenario: Subscription detail

- **WHEN** an operator opens the detail of a Brazil subscription whose address has no neighborhood
- **THEN** `courier_issues` is `["address_neighborhood_missing"]`, and no address problem is opened
