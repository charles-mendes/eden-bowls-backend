# admin-customer-subscriptions Specification

## Purpose

Defines what the admin customer detail returns about each of the customer's subscriptions, so an operator can validate the customer without opening every subscription or searching the production, delivery and NF-e queues.

## Requirements

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

### Requirement: Customer subscriptions carry operational alerts

Each subscription item of the customer detail MUST carry `alerts`, a list of `{ code, ... }` objects, `[]` when there is none. The list MUST be in this order: `nfe_problem`, `nfe_missing`, `delivery_failed`, `ready_not_dispatched`, `pending_change`. Each code MUST appear at most once. An alert MUST be computed only from what the actor can already read on that item. When the item carries `latestCycleUnavailable`, only `pending_change` MUST be computed. Computing alerts MUST NOT call Stripe or Bling.

#### Scenario: Subscription without problems

- **WHEN** a subscription's latest cycle is delivered, its note is authorized and nothing is pending
- **THEN** its `alerts` is `[]`

#### Scenario: Latest cycle unavailable

- **WHEN** the latest-cycle reads fail and the subscription has a pending edit
- **THEN** its `alerts` is only `pending_change`

### Requirement: NF-e problem alert

For a Brazil subscription and an actor with `nfe.read`, `nfe_problem` MUST be raised when the latest cycle's note is `rejected`, `error` or `blocked_missing_document`. It MUST be raised as soon as the note has that status. It MUST carry the note id, its status and its last error.

#### Scenario: Rejected note

- **WHEN** the latest cycle's note is rejected with the error "CPF inválido"
- **THEN** `alerts` has `{ code: "nfe_problem", nfeId, status: "rejected", lastError: "CPF inválido" }`

#### Scenario: Note blocked for a missing CPF

- **WHEN** the note is `blocked_missing_document`
- **THEN** `nfe_problem` is raised with that status

### Requirement: Missing NF-e alert after 24 hours

For a Brazil subscription and an actor with `nfe.read`, `nfe_missing` MUST be raised when the latest cycle has no note, or its note is `pending` or `submitted`, and at least 24 hours have passed since the cycle's paid date. It MUST carry the note status (`null` with no note) and the paid date. Before 24 hours, or without a paid date, it MUST NOT be raised.

#### Scenario: Paid two days ago without a note

- **WHEN** the latest Brazil cycle was paid 48 hours ago and has no note
- **THEN** `alerts` has `{ code: "nfe_missing", status: null, paidAt }`

#### Scenario: Paid an hour ago

- **WHEN** the cycle was paid 1 hour ago and its note is pending
- **THEN** no NF-e alert is raised

#### Scenario: US subscription

- **WHEN** the subscription is `stripe_account=us`
- **THEN** no NF-e alert is raised

### Requirement: Failed delivery alert

For an actor with `shipping.read`, `delivery_failed` MUST be raised when the latest cycle's delivery is a courier delivery whose status is `failed`. The latest non-canceled attempt is the one shown, so a failed one means nobody tried again. It MUST carry the courier delivery id and its failed date.

#### Scenario: Failed with no new attempt

- **WHEN** the latest non-canceled courier attempt of the latest cycle failed
- **THEN** `alerts` has `delivery_failed` with that attempt's id and failed date

#### Scenario: Failed then delivered

- **WHEN** a failed attempt was followed by a delivered one
- **THEN** no `delivery_failed` is raised

### Requirement: Ready but not dispatched alert

For an actor with both `production.read` and `shipping.read`, `ready_not_dispatched` MUST be raised when:
- the latest cycle's production status is `ready`;
- it has no delivery (no non-canceled courier delivery and no active UPS shipment);
- its delivery date is today or earlier, in the market's time zone (`America/Sao_Paulo` for Brazil, `America/New_York` for the US).

It MUST carry the delivery date. Without a delivery date it MUST NOT be raised.

#### Scenario: Ready on the delivery day

- **WHEN** a Brazil cycle is ready, not dispatched, and its delivery date is today in São Paulo
- **THEN** `alerts` has `{ code: "ready_not_dispatched", deliveryDate }`

#### Scenario: Ready ahead of time

- **WHEN** the cycle is ready and not dispatched but delivers tomorrow
- **THEN** no `ready_not_dispatched` is raised

#### Scenario: Ready and already on the road

- **WHEN** the ready cycle has a courier delivery out for delivery
- **THEN** no `ready_not_dispatched` is raised

### Requirement: Pending change alert

`pending_change` MUST be raised when the subscription has an edit waiting for payment or a non-empty pending delivery change. It MUST carry `kinds`, with `edit` and/or `delivery`, in that order. It needs no permission beyond the customer detail's.

#### Scenario: Pending delivery change

- **WHEN** the subscription has a pending delivery change and no pending edit
- **THEN** `alerts` has `{ code: "pending_change", kinds: ["delivery"] }`

#### Scenario: Both pending

- **WHEN** the subscription has a pending edit and a pending delivery change
- **THEN** `kinds` is `["edit", "delivery"]`

### Requirement: A subscription owns a pet while it still holds it

A subscription MUST count as owning a pet only when its status is `active`, `trialing`, `past_due`, `paused` or `incomplete`, and the pet is on its plan and not disabled. A pet with `enabled: false` in the plan selection MUST NOT count, even when its id is still in the pets snapshot. Only a plan selection with no pets and no priced lines MUST fall back to the pets snapshot. Both customer reads below MUST use this one rule.

#### Scenario: Late payment still owns the pet

- **WHEN** the customer's only subscription with pet `Rex` is `past_due`
- **THEN** that subscription owns `Rex`

#### Scenario: Paused subscription owns the pet

- **WHEN** the customer's only subscription with pet `Rex` is `paused`
- **THEN** that subscription owns `Rex`

#### Scenario: Checkout not paid yet owns the pet

- **WHEN** the customer's only subscription with pet `Rex` is `incomplete`
- **THEN** that subscription owns `Rex`

#### Scenario: Canceled subscription

- **WHEN** the only subscription with pet `Rex` is `canceled`
- **THEN** no subscription owns `Rex`

#### Scenario: Disabled pet

- **WHEN** an `active` subscription has `Rex` in its pets snapshot and `Rex` has `enabled: false` in its plan selection
- **THEN** that subscription does not own `Rex`

#### Scenario: Every plan pet disabled

- **WHEN** an `active` subscription has `Rex` in its pets snapshot and every pet in its plan selection, `Rex` included, has `enabled: false`
- **THEN** that subscription owns no pet, and the pets snapshot is not used

#### Scenario: Old subscription without plan pets

- **WHEN** an `active` subscription has no pets in its plan selection and `Rex` in its pets snapshot
- **THEN** that subscription owns `Rex`

### Requirement: Customer subscriptions list their pets

Each item of `subscriptions` in `GET /api/v1/admin/users/:userId` MUST carry `pets`, the pets that subscription owns, each with `id` and `name` from the subscription. The list MUST always be present and MUST be `[]` when the subscription owns no pet, including any subscription whose status does not own pets. It MUST follow the subscription list's market scope. This read MUST NOT call Stripe.

#### Scenario: Subscription with two pets

- **WHEN** an operator with `users.read` opens a customer whose `active` subscription has `Rex` and `Luna` enabled
- **THEN** that subscription item carries `pets` with `Rex` and `Luna`, each with its id

#### Scenario: Canceled subscription

- **WHEN** the customer has a `canceled` subscription that had `Rex`
- **THEN** that subscription item carries `pets: []`

#### Scenario: Latest cycle unavailable

- **WHEN** reading the latest cycles fails for the customer
- **THEN** each subscription item still carries its `pets`

### Requirement: Customer checkout pets show the subscription that owns them

Each pet in `GET /api/v1/admin/onboarding/checkouts/:userId` MUST carry `subscriptions`, the subscriptions that own it, each with `id`, `stripeSubscriptionId`, `status` and `planLabel`, newest first. The list MUST always be present and MUST be `[]` when no subscription owns the pet. It MUST only use the subscriptions this route already returns for the actor's market scope.

#### Scenario: Pet on an active subscription

- **WHEN** an operator with `onboarding.read` opens a customer whose pet `Rex` is enabled on an `active` subscription `sub_1`
- **THEN** `Rex` carries `subscriptions` with one item for `sub_1` and status `active`

#### Scenario: Pet on no subscription

- **WHEN** the customer's pet `Luna` is on no subscription, or only on a `canceled` one
- **THEN** `Luna` carries `subscriptions: []`

#### Scenario: Pet on two owning subscriptions

- **WHEN** `Rex` is on a `paused` subscription created in October and on an `active` one created in November
- **THEN** `Rex` carries both, the November subscription first

#### Scenario: Subscription of another market

- **WHEN** an operator scoped to Brazil opens a customer whose pet `Rex` is on a `stripe_account=us` subscription
- **THEN** `Rex` carries `subscriptions: []`
