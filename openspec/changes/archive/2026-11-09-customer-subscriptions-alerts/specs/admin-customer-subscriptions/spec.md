## ADDED Requirements

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
