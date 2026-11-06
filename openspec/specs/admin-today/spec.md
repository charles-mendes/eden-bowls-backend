# admin-today Specification

## Purpose

Defines what `GET /api/v1/admin/today` returns about shipping, invoices and contacts, so the day's start screen points to where each pending item is solved.

## Requirements

### Requirement: Unconfirmed UPS purchases are not reported as missing labels

For a paid US cycle, `upsLabel` MUST be `unresolved` when its invoice has a UPS shipment `pending` or `unknown`, `created` when it has one `created` or `delivered`, and `missing` when it has none that is not voided.

#### Scenario: UPS did not answer

- **WHEN** a ready US cycle's invoice has a shipment `unknown`
- **THEN** its item carries `upsLabel: "unresolved"`

#### Scenario: Label created

- **WHEN** the shipment is `created`
- **THEN** its item carries `upsLabel: "created"`

### Requirement: Brazil items say where the box is

For a paid Brazil cycle (by delivery address, as the courier queue), each item MUST carry `courierDelivery`: `none` when its invoice has no courier delivery, otherwise the status of its latest delivery (`out_for_delivery`, `delivered` or `failed`). A canceled delivery MUST count as none. Other items MUST carry `null`.

#### Scenario: On the road

- **WHEN** a ready Brazil cycle's invoice has a delivery out for delivery
- **THEN** its item carries `courierDelivery: "out_for_delivery"`

#### Scenario: Not dispatched

- **WHEN** a ready Brazil cycle's invoice has only a canceled delivery
- **THEN** its item carries `courierDelivery: "none"`

### Requirement: Today counts shipping and invoice work on its own

The response MUST carry a `fulfillment` block, counted by its own queries and not limited by the 200 items of the list, within the actor's market scope. Each count MUST follow the rule of the screen it links to, not the size of an already cut list: Brazil cycles to dispatch (the courier "A despachar" rule in its default range: paid Brazil cycle delivered from 30 days ago to tomorrow, with no active delivery and no open failure), deliveries on the road for more than 24 hours since they left, failed deliveries with no new dispatch (the latest delivery of the invoice is failed, as in "Falhas"), NF-e `blocked_missing_document`, `rejected` and `error`, and US shipments `pending` or `unknown`. It MUST carry `blingConnected` only for an actor with `bling.connect`, and `null` otherwise. Counts for a market outside the actor's scope MUST be 0.

The block MUST also carry `addressIssues`, with `BR` and `US` entries of `open` (address problems open for subscriptions of that market's Stripe account) and `stale` (those open for 72 hours or more, the point from which the panel shows "Sem correção há N dias"), and `marketExceptions`, with `BR` and `US` entries of the number of subscriptions in market exception for the actor, by the rule of the market exceptions list but without its 200-item limit, by the market of their Stripe account (`br` → `BR`, `us` → `US`).

The block MUST also carry `courierAwaitingNfe`: when the courier fiscal lock is on, the number of Brazil cycles to dispatch (by the same rule as the courier count) whose invoice has no NF-e `authorized` for its Stripe account, no note counted as not authorized; when the lock is off, `null`. It MUST be 0 for an actor who does not see Brazil. It is part of the to-dispatch count, which MUST NOT change, and MUST NOT count failed deliveries.

#### Scenario: Brazil operator

- **WHEN** a Brazil operator opens Today with two cycles to dispatch and one rejected NF-e
- **THEN** `fulfillment` reports 2 to dispatch and 1 rejected, and the US counts are 0

#### Scenario: More than 200 items

- **WHEN** 250 cycles are due and 230 Brazil cycles are ready to dispatch
- **THEN** the list is truncated at 200 and `fulfillment` still reports 230 to dispatch

#### Scenario: Cycle to dispatch later

- **WHEN** a paid Brazil cycle with no delivery has a delivery date in three days
- **THEN** it is not counted to dispatch, as the courier queue does not list it in its default range

#### Scenario: Box sent again after a failure

- **WHEN** an invoice has a failed delivery and a later one on the road
- **THEN** it counts as on the road and not as a failure

#### Scenario: Bling for the admin

- **WHEN** an admin opens Today while Bling is disconnected
- **THEN** `blingConnected` is false; for an operator it is null

#### Scenario: Address problems by market

- **WHEN** an admin opens Today with two open Brazil address problems, one of them opened 3 days ago, and one open US problem opened today
- **THEN** `addressIssues.BR` is `{ open: 2, stale: 1 }` and `addressIssues.US` is `{ open: 1, stale: 0 }`

#### Scenario: Not yet stale

- **WHEN** a problem was opened 2 days and 20 hours ago
- **THEN** it counts as `open` and not as `stale`

#### Scenario: Closed problems are not counted

- **WHEN** a problem was closed by the customer yesterday
- **THEN** it is not counted in `addressIssues`

#### Scenario: Scoped operator

- **WHEN** a Brazil operator opens Today with one US problem and one market exception on a `us` account
- **THEN** `addressIssues.US` is `{ open: 0, stale: 0 }` and `marketExceptions` is `{ BR: 0, US: 0 }`

#### Scenario: Orders waiting for the NF-e

- **WHEN** the lock is on and three cycles are to dispatch, one with an authorized NF-e, one with a rejected NF-e and one with no NF-e
- **THEN** `courierAwaitingNfe` is 2

#### Scenario: Lock off

- **WHEN** the lock is off
- **THEN** `courierAwaitingNfe` is null

#### Scenario: Waiting for NF-e outside the scope

- **WHEN** the lock is on and a US operator opens Today
- **THEN** `courierAwaitingNfe` is 0

### Requirement: Refused payments show the last contact and the phone

Each `past_due` item MUST carry the last recorded contact of its subscription (reason, outcome, operator, time), or `null`, and the account phone, or `null`. Other items MUST NOT carry the phone.

#### Scenario: Contacted yesterday

- **WHEN** a past_due subscription had a contact yesterday with outcome `no_answer`
- **THEN** its item carries that contact
