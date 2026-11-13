# Spec Delta

## ADDED Requirements

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
