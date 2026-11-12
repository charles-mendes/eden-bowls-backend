## MODIFIED Requirements

### Requirement: The production queue keeps a ready Brazil order until it leaves

When overdue cycles are included, the production queue MUST keep, besides the overdue cycles not `ready`, every paid cycle with production status `ready` whose preparation day is before today and no more than 30 days ago, whose shipping market is Brazil (`br` account and address in Brazil), and whose invoice has no courier delivery on the road, delivered or failed (a kept `ready` cycle). The cycle MUST leave the queue once a delivery is registered for its invoice. A `ready` cycle of the US market or in market exception MUST NOT be kept this way. A kept `ready` cycle MUST be listed when the request asks for no due filter. Under the `due=overdue` filter it MUST be listed only when the request also asks for production status `ready`. The queue's overdue metric MUST count only overdue cycles not `ready`. With `due=overdue` and no other filter, the list MUST hold exactly the cycles the overdue metric counts; a search, market or production status filter narrows that set.

#### Scenario: Late order marked ready

- **WHEN** an operator marks `ready` a paid Brazil cycle prepared 24 days ago with no courier delivery
- **THEN** the queue without a due filter still lists it with production status `ready`, the queue with `due=overdue` no longer lists it, and the overdue metric no longer counts it

#### Scenario: Overdue filter matches the overdue metric

- **WHEN** the queue holds a kept `ready` Brazil cycle prepared 8 days ago and no overdue cycle that is not `ready`, and the operator lists the queue with `due=overdue`
- **THEN** the overdue metric is 0 and the list is empty

#### Scenario: Overdue filter with the ready status

- **WHEN** the operator lists the queue with `due=overdue` and production status `ready`
- **THEN** the list holds the kept `ready` Brazil cycle prepared 8 days ago

#### Scenario: Ready order without a due filter

- **WHEN** the operator lists the queue without a due filter, or with production status `ready` and no due filter
- **THEN** the kept `ready` Brazil cycle prepared 8 days ago is listed

#### Scenario: Box left

- **WHEN** that cycle's invoice gets a delivery out for delivery
- **THEN** the cycle is no longer in the queue

#### Scenario: Past the floor

- **WHEN** a `ready` Brazil cycle with no delivery was prepared 31 days ago
- **THEN** it is not in the queue

#### Scenario: US order

- **WHEN** a paid US cycle prepared 3 days ago is `ready`
- **THEN** it is not in the queue
