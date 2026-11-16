## MODIFIED Requirements

### Requirement: Today counts shipping and invoice work on its own

The response MUST carry a `fulfillment` block, counted by its own queries and not limited by the 200 items of the list, within the actor's market scope. Each count MUST follow the rule of the screen it links to, not the size of an already cut list: Brazil cycles to dispatch (the courier "A despachar" rule in its default range and its default `preparo`: a paid Brazil cycle with production status `ready`, delivered from 30 days ago to tomorrow, with no active delivery and no open failure), deliveries on the road for more than 24 hours since they left, failed deliveries with no new dispatch (the latest delivery of the invoice is failed, as in "Falhas"), NF-e `blocked_missing_document`, `rejected` and `error`, and US shipments `pending` or `unknown`. It MUST carry `blingConnected` only for an actor with `bling.connect`, and `null` otherwise. Counts for a market outside the actor's scope MUST be 0.

The block MUST also carry `addressIssues`, with `BR` and `US` entries of `open` (address problems open for subscriptions of that market's Stripe account) and `stale` (those open for 72 hours or more, the point from which the panel shows "Sem correção há N dias"), and `marketExceptions`, with `BR` and `US` entries of the number of subscriptions in market exception for the actor, by the rule of the market exceptions list but without its 200-item limit, by the market of their Stripe account (`br` → `BR`, `us` → `US`).

The block MUST also carry `courierAwaitingNfe`: when the courier fiscal lock is on, the number of Brazil cycles in that same to-dispatch count whose invoice has no NF-e `authorized` for its Stripe account, no note counted as not authorized; when the lock is off, `null`. It MUST be 0 for an actor who does not see Brazil. It is part of the to-dispatch count and MUST NOT include a cycle that is not `ready` or a failed delivery.

The block MUST also carry `upsLabelsWithoutPickup`: the US labels `created`, with no `requested` or `unknown` pickup and no tracking scan yet, by the rule of the label queue's pickup section. It MUST be 0 for an actor who does not see the US.

#### Scenario: Brazil operator

- **WHEN** a Brazil operator opens Today with two `ready` cycles to dispatch and one rejected NF-e
- **THEN** `fulfillment` reports 2 to dispatch and 1 rejected, and the US counts are 0

#### Scenario: A cycle still in the kitchen

- **WHEN** a paid Brazil cycle delivered tomorrow is `in_production` and has no courier delivery
- **THEN** it is not counted in `courierToDispatch` or in `courierAwaitingNfe`

#### Scenario: More than 200 items

- **WHEN** 250 cycles are due and 230 Brazil cycles are `ready` and to dispatch
- **THEN** the list is truncated at 200 and `fulfillment` still reports 230 to dispatch

#### Scenario: Cycle to dispatch later

- **WHEN** a paid `ready` Brazil cycle with no delivery has a delivery date in three days
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

- **WHEN** the lock is on and three `ready` cycles are to dispatch, one with an authorized NF-e, one with a rejected NF-e and one with no NF-e
- **THEN** `courierToDispatch` is 3 and `courierAwaitingNfe` is 2

#### Scenario: Lock off

- **WHEN** the lock is off
- **THEN** `courierAwaitingNfe` is null

#### Scenario: Waiting for NF-e outside the scope

- **WHEN** the lock is on and a US operator opens Today
- **THEN** `courierAwaitingNfe` is 0

#### Scenario: Labels waiting for a pickup

- **WHEN** three US labels are created today, two of them in a requested pickup
- **THEN** `upsLabelsWithoutPickup` is 1

#### Scenario: Box already scanned

- **WHEN** a created label without a pickup already has a UPS scan
- **THEN** it is not counted

#### Scenario: Labels without pickup outside the scope

- **WHEN** a Brazil operator opens Today with a US label without pickup
- **THEN** `upsLabelsWithoutPickup` is 0
