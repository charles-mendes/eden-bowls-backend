## Purpose

Defines what the admin customer detail returns about each of the customer's subscriptions, so an operator can validate the customer without opening every subscription or searching the production, delivery and NF-e queues.

## ADDED Requirements

### Requirement: Customer subscriptions carry their contract data

Each item of `subscriptions` in `GET /api/v1/admin/users/:userId` MUST carry, from the stored subscription and alongside the fields it already has: the market (`stripeAccount`), the start date (`createdAt`), the term in months, the charged deliveries, and whether it renews automatically. A value the subscription does not store MUST be `null`. This read MUST NOT call Stripe or Bling.

#### Scenario: Subscription with a 6-month term

- **WHEN** an operator with `users.read` opens a customer whose subscription has a 6-month term, 2 charged deliveries and auto renew on
- **THEN** that subscription item carries `subscriptionTermMonths: 6`, `chargedDeliveries: 2` and `autoRenew: true`, with its market and start date

#### Scenario: Old subscription without a term

- **WHEN** the subscription stores no term and no charged deliveries
- **THEN** those fields are `null` and the customer detail still loads

### Requirement: Payment and checkout freight follow billing access

A subscription item MUST carry `paymentMethod` (`brand`, `last4`) and `checkoutShipping` (`label`, `amount`, `currency`) only when the actor has `billing.subscribers.read`. `checkoutShipping` MUST be read from the subscription's checkout shipping snapshot. Its amount MUST be the cost, else the total. It MUST be `null` when there is no snapshot. It MUST NOT carry the quote token or the rest of the snapshot. Without that permission both keys MUST be absent.

#### Scenario: Billing operator

- **WHEN** an operator with `billing.subscribers.read` opens a customer whose subscription paid R$ 25,00 of freight with a Visa ending in 4242
- **THEN** the item carries `paymentMethod: { brand: "visa", last4: "4242" }` and `checkoutShipping` with amount `25` and currency `BRL`

#### Scenario: Operator without billing access

- **WHEN** an actor with `users.read` and no `billing.subscribers.read` opens the same customer (no current role has that set; this guards a future role split)
- **THEN** the item has neither `paymentMethod` nor `checkoutShipping`

### Requirement: Each subscription shows its latest paid cycle

When the actor has at least one of `production.read`, `shipping.read` or `nfe.read`, each subscription item MUST carry `latestCycle`. It is the subscription's newest paid cycle, in the same order and from the same source as the paid-cycles list. It MUST carry the paid invoice id, paid date, preparation day and delivery date. It MUST be `null` when the subscription has no paid cycle. Without any of those permissions the key MUST be absent.

#### Scenario: Subscription with two paid cycles

- **WHEN** a subscription has paid cycles delivering on 2026-10-10 and 2026-11-10
- **THEN** `latestCycle` is the cycle delivering on 2026-11-10, with its invoice id and paid date

#### Scenario: Subscription not paid yet

- **WHEN** the subscription has no paid cycle
- **THEN** `latestCycle` is `null`

#### Scenario: Old zero-value invoice

- **WHEN** the subscription's only paid invoice is a zero-value invoice with no production cycle
- **THEN** `latestCycle` is `null`

### Requirement: The latest cycle shows production to production readers

`latestCycle` MUST carry `production` (`status`, `note`) only when the actor has `production.read`. The status MUST be the one the production queue shows for that cycle. Without that permission the key MUST be absent.

#### Scenario: Cycle ready

- **WHEN** a production operator opens a customer whose latest cycle is marked ready with the note "sem frango"
- **THEN** `latestCycle.production` is `{ status: "ready", note: "sem frango" }`

### Requirement: The latest cycle shows delivery to shipping readers

`latestCycle` MUST carry `delivery` only when the actor has `shipping.read`. It MUST be one of:
- the latest courier delivery of the paid invoice that was not canceled (`kind: "courier"`, status, out for delivery, delivered and failed dates);
- the active UPS shipment (`kind: "ups"`, status, tracking number);
- `null` when there is neither.

When the invoice has both, the courier delivery MUST win. Without that permission the key MUST be absent.

#### Scenario: Brazil cycle delivered by courier

- **WHEN** the latest cycle's invoice has a canceled courier attempt and a later delivered one
- **THEN** `latestCycle.delivery` is the delivered attempt with `kind: "courier"` and its delivered date

#### Scenario: US cycle with a label

- **WHEN** the latest cycle's invoice has an active UPS shipment with tracking `1Z999`
- **THEN** `latestCycle.delivery` has `kind: "ups"` and `trackingNumber: "1Z999"`

#### Scenario: Invoice with courier and UPS

- **WHEN** the latest cycle's invoice has a non-canceled courier delivery and an active UPS shipment
- **THEN** `latestCycle.delivery` has `kind: "courier"`

#### Scenario: Cycle not dispatched

- **WHEN** the latest cycle has no courier delivery and no active UPS shipment
- **THEN** `latestCycle.delivery` is `null`

### Requirement: The latest cycle shows the NF-e to NF-e readers

For a Brazil subscription, `latestCycle` MUST carry `nfe` only when the actor has `nfe.read`. It is the note recorded for the paid invoice in that subscription's Stripe account, with id, number, series, status, last error and email status. It MUST be `null` when no note is recorded. A subscription of another market MUST NOT carry the key. Without `nfe.read` the key MUST be absent.

#### Scenario: Rejected note

- **WHEN** an operator with `nfe.read` opens a Brazil customer whose latest cycle's note was rejected with an error from Bling
- **THEN** `latestCycle.nfe` carries the rejected status and that last error

#### Scenario: Paid cycle without a note

- **WHEN** the latest Brazil cycle has no NF-e recorded
- **THEN** `latestCycle.nfe` is `null`

#### Scenario: US subscription

- **WHEN** the subscription is `stripe_account=us`
- **THEN** `latestCycle` has no `nfe` key

### Requirement: Linked reads do not break the customer detail

The latest cycles of one customer are read together. If reading the latest cycle or any of its linked records fails, the customer detail MUST still return `200` with the rest of its data. Every listed subscription item MUST then carry `latestCycleUnavailable: true` and no `latestCycle`. When those reads succeed, no item MUST carry `latestCycleUnavailable`.

#### Scenario: NF-e lookup fails

- **WHEN** the NF-e lookup throws while a customer detail is loaded by an operator with `nfe.read`
- **THEN** the response is `200`, the profile and the subscription list are present, and each subscription item carries `latestCycleUnavailable: true`

#### Scenario: Reads succeed

- **WHEN** every latest-cycle read succeeds
- **THEN** no subscription item carries `latestCycleUnavailable`

### Requirement: Linked records stay in the subscription's market

The customer detail MUST build `latestCycle` only for subscriptions that are in the actor's markets. It MUST read its linked courier, UPS and NF-e records only by that subscription's paid invoice and Stripe account.

#### Scenario: Brazil operator, customer with a US subscription

- **WHEN** an operator assigned `BR` opens a customer who has a Brazil and a US subscription
- **THEN** only the Brazil subscription is listed, with its `latestCycle`, and nothing from the US subscription's cycle appears
