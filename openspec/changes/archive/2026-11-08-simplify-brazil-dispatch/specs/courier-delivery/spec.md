## MODIFIED Requirements

### Requirement: The queue lists Brazil delivery work in four groups

The admin queue MUST list, for Brazil subscriptions: to dispatch, which is paid cycles with no active delivery and no failed delivery whose delivery date falls in the requested delivery range; out for delivery, which is every delivery in that status, whatever its age; failed, which is every failed delivery whose invoice has no active delivery, whatever its age; and delivered, which is deliveries whose delivered date falls in the last 7 days. Days are civil days in `America/Sao_Paulo`, with today counted. An invoice MUST appear in one group only.

Without `preparo`, or with `preparo=prontos`, to dispatch MUST include only cycles whose production status is `ready`. A cycle with no production status MUST count as not ready. `preparo=todos` MUST list every paid cycle to dispatch, ready or not. Any other `preparo` MUST be refused with `400 invalid_preparo` and list nothing. `later`, the 200-item limit and `next_from` MUST follow the same `preparo`. The response MUST carry `preparo` as `prontos` or `todos`. Out for delivery, failed and delivered MUST NOT change with `preparo`.

The delivery range is `from` to `to`, both civil dates included. Without `from`, it starts 30 days before today; without `to`, it ends tomorrow. The range MUST NOT start earlier than 30 days before today, end before it starts, or have `to` more than 31 days after `from` (the default range, 30 days ago to tomorrow, is exactly 31 days); such a request, or a date that is not `YYYY-MM-DD`, MUST be refused with `400 invalid_delivery_range`. The range limits only the to dispatch group.

The response MUST carry `range` (`from`, `to`, and `default`, true when neither date was sent), `later` (how many cycles would be to dispatch with a delivery date after `to`, counted without the list's limit), and `truncated`. The 200-item limit MUST count only cycles to dispatch: a cycle whose invoice already has a delivery out for delivery, delivered or failed MUST NOT take a place in it. When the to dispatch list is cut at that limit, the response MUST carry `next_from`, the delivery date of the first cycle left out; otherwise `next_from` is null.

#### Scenario: Paid cycle waiting

- **WHEN** a Brazil subscription has a paid cycle with production status `ready`, no courier delivery, delivered tomorrow
- **THEN** the queue lists it under to dispatch in the default range and `preparo` is `prontos`

#### Scenario: Not ready stays out

- **WHEN** a paid cycle with no courier delivery, delivered tomorrow, has production status `in_production` and the queue is read without `preparo`
- **THEN** the queue does not list it under to dispatch

#### Scenario: Show every paid cycle

- **WHEN** the same cycle is read with `preparo=todos`
- **THEN** the queue lists it under to dispatch and `preparo` is `todos`

#### Scenario: Unknown preparo

- **WHEN** the queue is read with `preparo=abertos`
- **THEN** the request is refused with `400 invalid_preparo`

#### Scenario: Cycle after the default range

- **WHEN** a paid cycle with production status `ready` and no courier delivery has a delivery date in three days and the queue is read without a range
- **THEN** the queue does not list it under to dispatch and `later` counts it

#### Scenario: A later cycle that is not ready

- **WHEN** a paid cycle with production status `to_prepare` and no courier delivery has a delivery date in three days and the queue is read without `preparo`
- **THEN** `later` does not count it

#### Scenario: Range that reaches the cycle

- **WHEN** the queue is read with `from` today and `to` in five days for a `ready` cycle delivered in three days
- **THEN** the cycle is listed under to dispatch and `range.default` is false

#### Scenario: Old paid cycle

- **WHEN** a paid `ready` cycle with no courier delivery has a delivery date 31 days ago
- **THEN** the queue does not list it

#### Scenario: Default range is accepted

- **WHEN** the queue is read with `from` 30 days ago and `to` tomorrow
- **THEN** the request is accepted, as the default range is

#### Scenario: Range before the floor

- **WHEN** the queue is read with `from` 40 days ago
- **THEN** the request is refused with `400 invalid_delivery_range`

#### Scenario: List cut at the limit

- **WHEN** 230 `ready` cycles are to dispatch in the range and 40 more are still `in_production`
- **THEN** the queue lists 200 of the ready cycles, `truncated` is true and `next_from` is the delivery date of the 201st ready cycle

#### Scenario: Boxes already sent do not take places

- **WHEN** the range has 250 paid `ready` cycles, 120 of them already delivered or on the road, and 130 to dispatch
- **THEN** "A despachar" lists the 130 and `truncated` is false

#### Scenario: Long on the road

- **WHEN** a delivery has been out for delivery since a cycle whose delivery date is 40 days ago
- **THEN** the queue still lists it under out for delivery

#### Scenario: Out for delivery outside the range

- **WHEN** a delivery is out for delivery for a cycle delivered in four days and the queue is read without a range
- **THEN** the queue still lists it under out for delivery

#### Scenario: Old failure

- **WHEN** a delivery failed 40 days ago and the invoice has no active delivery
- **THEN** the queue lists it under failed and not under to dispatch

#### Scenario: Failed then dispatched again

- **WHEN** a delivery failed and the invoice was dispatched again
- **THEN** the queue lists the invoice only under out for delivery

#### Scenario: Delivered window

- **WHEN** one delivery was delivered 6 civil days ago in São Paulo and another 8 civil days ago
- **THEN** the queue lists the first under delivered and not the second

#### Scenario: Zero-subtotal cycle

- **WHEN** a Brazil subscription skipped a cycle and its paid invoice has subtotal zero
- **THEN** the queue does not list that cycle, because a skipped cycle never becomes a paid production cycle

#### Scenario: Other groups ignore preparo

- **WHEN** the queue is read with `preparo=todos` and a delivery is out for delivery
- **THEN** that delivery is listed under out for delivery, as it is without `preparo`

## ADDED Requirements

### Requirement: The production queue names the paid invoice

Each production queue item MUST include `paidInvoiceId`. On a paid cycle it MUST be that cycle's paid invoice id. On a cycle that is not paid it MUST be null.

#### Scenario: Paid cycle

- **WHEN** the production queue lists a paid cycle whose invoice is `in_123`
- **THEN** the item's `paidInvoiceId` is `in_123`

#### Scenario: Unpaid cycle

- **WHEN** the production queue lists a cycle awaiting payment
- **THEN** the item's `paidInvoiceId` is null
