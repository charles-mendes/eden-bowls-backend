## ADDED Requirements

### Requirement: Today counts the orders to dispatch held by the address

The `fulfillment` block MUST carry `courierAddressLocked`. It counts the Brazil cycles in the `courierToDispatch` count whose subscription address the dispatch would refuse with `courier_address_incomplete`, by the same address rule as the dispatch. It is part of `courierToDispatch`, MAY overlap `courierAwaitingNfe`, and MUST NOT depend on whether an address problem is open. It MUST be 0 for an actor who does not see Brazil.

#### Scenario: Two of three held

- **WHEN** a Brazil operator opens Today with three `ready` cycles to dispatch, two of them with no recipient name
- **THEN** `courierToDispatch` is 3 and `courierAddressLocked` is 2

#### Scenario: No problem opened yet

- **WHEN** a `ready` cycle to dispatch has no number in its address and no address problem was ever opened for it
- **THEN** it counts in `courierAddressLocked`, and `addressIssues.BR.open` does not change

#### Scenario: Outside the scope

- **WHEN** a US operator opens Today while Brazil cycles to dispatch are held by the address
- **THEN** `courierAddressLocked` is 0

### Requirement: Overdue counts only late kitchen work

Today's `overdue` counts (totals and per market) MUST count only queue items whose production status is not `ready`. A `ready` Brazil cycle that the production queue keeps after its preparation day, because its box has not left, MUST NOT count as overdue; it is counted by `courierToDispatch` when it falls in that count's range. The "pedidos atrasados" pending item MUST follow the same count.

#### Scenario: Late order marked ready

- **WHEN** a paid Brazil cycle prepared 24 days ago with no courier delivery is marked `ready`
- **THEN** Today's overdue count drops by one and `courierToDispatch` counts that cycle
