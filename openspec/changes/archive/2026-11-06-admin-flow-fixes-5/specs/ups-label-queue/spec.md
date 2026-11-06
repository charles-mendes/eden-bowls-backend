## MODIFIED Requirements

### Requirement: Queue lists label work

The admin panel MUST list every paid US production cycle with no active label and a delivery date in the requested delivery range, every created label that is not delivered or voided, and every unresolved row. An order is ready when its invoice is paid, its address is complete, ship-from is set, and it has no active label. Brazil subscriptions MUST NOT be listed for any actor.

The delivery range is `from` to `to`, both civil dates included, with today taken in `America/New_York`. Without `from`, it starts 30 days before today; without `to`, it ends tomorrow. The range MUST NOT start earlier than 30 days before today, end before it starts, or have `to` more than 31 days after `from`; such a request, or a date that is not `YYYY-MM-DD`, MUST be refused with `400 invalid_delivery_range`. The range and the 100-item limit apply only to cycles with no active label. Created labels that are not delivered or voided, and unresolved rows, MUST be listed whatever their delivery date, as long as it is no more than 30 days in the past, and MUST NOT take a place in the 100.

The response MUST carry `range` (`from`, `to`, and `default`, true when neither date was sent), `later` (how many paid cycles with no active label have a delivery date after `to`, counted without the list's limit), and `truncated`. When the list is cut at its 100-item limit, the response MUST carry `next_from`, the delivery date of the first cycle left out; otherwise `next_from` is null.

#### Scenario: Ready order

- **WHEN** a US subscription has a paid cycle delivered today, a complete address, ship-from is set, and no active label exists
- **THEN** the queue lists the order as ready and selectable

#### Scenario: Ready order after the default range

- **WHEN** a paid cycle with no label has a delivery date in four days and the queue is read without a range
- **THEN** the queue does not list it as ready and `later` counts it

#### Scenario: Two paid cycles without a label

- **WHEN** one US subscription has two paid cycles in the range and neither has a label
- **THEN** the queue lists both cycles

#### Scenario: Old cycle

- **WHEN** a paid cycle without a label has a delivery date 31 days ago
- **THEN** the queue does not list it

#### Scenario: Range too long

- **WHEN** the queue is read with a range of 40 days
- **THEN** the request is refused with `400 invalid_delivery_range`

#### Scenario: Label already created

- **WHEN** an invoice has a created label that is not delivered or voided, for a delivery in five days
- **THEN** the queue lists the label as created in the default range, and it can be selected for printing

#### Scenario: Created label with a full ready list

- **WHEN** 100 cycles without a label are in the range and one created label exists for a delivery in five days
- **THEN** the queue lists the 100 as ready and the created label as created

#### Scenario: List cut at the limit

- **WHEN** 120 cycles without a label are in the range
- **THEN** the queue lists 100, `truncated` is true and `next_from` is the delivery date of the 101st

#### Scenario: Brazil order

- **WHEN** a Brazil subscription has a paid cycle, even for an admin with access to every market
- **THEN** the queue does not list it

#### Scenario: Staff limited to Brazil

- **WHEN** a staff member scoped to Brazil opens the queue
- **THEN** the queue lists nothing
