# Spec Delta

## ADDED Requirements

### Requirement: A problem closes when the subscription ends with nothing left to ship

An open address problem MUST close with `resolved_by: ended` when its subscription is `canceled` (Stripe `canceled` or `incomplete_expired`) and has no paid cycle whose box has not left. A cycle not paid yet MUST NOT keep it open. A box has left when the cycle's invoice has a courier delivery on the road or delivered, or a UPS label created or delivered. The rule MUST be checked when Stripe reports the subscription changed, after a courier dispatch and after a UPS label is created. Closing MUST NOT send an email.

#### Scenario: Canceled after the last box was delivered

- **WHEN** a subscription whose only paid cycle was delivered by courier, with an open problem for `recipient_name_missing`, is canceled in Stripe
- **THEN** the problem closes with `resolved_by: ended`, no email is sent, and Today no longer counts it

#### Scenario: Canceled with a paid box still to leave

- **WHEN** a subscription with an open problem is canceled while a paid cycle has no courier delivery and no UPS label
- **THEN** the problem stays open

#### Scenario: Last box leaves after the cancellation

- **WHEN** that canceled subscription's last paid cycle is then dispatched by courier, or gets a UPS label created
- **THEN** the problem closes with `resolved_by: ended`

#### Scenario: Cycle not paid yet

- **WHEN** a canceled subscription's only paid cycle was delivered and it also has a cycle with no payment
- **THEN** the problem closes with `resolved_by: ended`

#### Scenario: Failed delivery

- **WHEN** a canceled subscription's last paid cycle has only a failed courier delivery
- **THEN** the problem stays open

#### Scenario: Active subscription with every box delivered

- **WHEN** an active subscription with an open problem has every paid cycle delivered
- **THEN** the problem stays open, because the next cycle needs the address

#### Scenario: No problem open

- **WHEN** a subscription with no open problem ends
- **THEN** nothing opens and nothing is recorded

### Requirement: Open problems of ended subscriptions close at deploy

The deploy MUST close, with `resolved_by: ended`, every open problem that already meets the rule of the requirement above, and MUST NOT send an email. Problems that do not meet it MUST stay open, unchanged.

#### Scenario: Problem left open by an earlier cancellation

- **WHEN** the deploy runs and a canceled subscription, whose only paid cycle was delivered, has a problem open since before the deploy
- **THEN** that problem closes with `resolved_by: ended` and no email is sent

#### Scenario: Problem of an active subscription

- **WHEN** the deploy runs and an active subscription has an open problem
- **THEN** that problem stays open
