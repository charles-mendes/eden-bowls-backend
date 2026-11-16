## MODIFIED Requirements

### Requirement: An address problem opens only on an event

An address problem MUST open only on one of these events: a paid cycle whose address fails its market's check (`payment_check`), a courier dispatch refused for the address (`courier_check`), a label purchase refused by an address check (`ups_check`), a courier failure recorded with `failure_kind: address_unusable` (`courier_failed`), or an NF-e blocked for a missing CPF or fiscal name (`nfe_check`). Reading a queue, a detail or Today's counts MUST NOT open one, nor MUST a change of production status, including marking a cycle `ready` while its address would be refused at dispatch; the operator sees the lock and decides, and the customer is told only on one of the events above. A market exception MUST NOT open one on any event.

#### Scenario: Dispatch refused

- **WHEN** an operator dispatches a Brazil cycle whose address has no number
- **THEN** the dispatch is refused and an address problem opens with source `courier_check` and code `address_number_missing`

#### Scenario: Queue read

- **WHEN** the courier queue lists a cycle whose address has no number and no problem is open
- **THEN** no problem opens and no email is sent

#### Scenario: Failure with another kind

- **WHEN** a courier failure is recorded with `failure_kind: customer_absent`
- **THEN** no address problem opens

#### Scenario: Crossed dispatch

- **WHEN** a dispatch is refused with `shipment_market_exception`
- **THEN** no address problem opens and no email is sent

#### Scenario: Marked ready with an address held

- **WHEN** an operator marks `ready` a paid Brazil cycle whose address has no recipient name and no problem is open
- **THEN** no address problem opens and no email is sent, and the production queue item shows `courierIssues: ["recipient_name_missing"]`

#### Scenario: Today and the subscription detail

- **WHEN** Today counts that cycle in `courierAddressLocked` and an operator opens its subscription detail with `courier_issues`
- **THEN** no address problem opens and no email is sent

#### Scenario: Dispatch tried afterwards

- **WHEN** an operator then tries to dispatch that cycle
- **THEN** the dispatch is refused and an address problem opens with source `courier_check`, as before
