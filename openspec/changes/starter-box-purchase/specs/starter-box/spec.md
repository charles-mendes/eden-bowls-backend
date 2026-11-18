# Spec Delta

## Purpose

Defines the Starter Box: the optional 10-day trial a new customer can buy once, how it is offered and priced, and how the one-per-customer limit is enforced.

## ADDED Requirements

### Requirement: The plan offers the Starter next to the plan terms

The plan snapshot (`GET /api/v1/onboarding/plan/snapshot`) MUST return a `starter` object next to `plan_terms`, with `available`, `reason`, `days`, `discount_percent`, `line_items` (recipe, pack size, pack count), `subtotal`, `discount` and `food_total`, in the market's currency. `days` and `discount_percent` MUST come from the market's plan settings. Each pet's pack size MUST be the one its monthly plan would use, and its pack count MUST be the pet's daily grams × `days`, divided by the pack size and rounded up, split across the chosen recipes the same way the monthly plan splits them. `discount` MUST be `discount_percent` of `subtotal`, and `food_total` MUST be `subtotal` − `discount`. Shipping MUST NOT be part of these amounts. `available` MUST be false, with `reason`, when the customer cannot buy a Starter (see the next requirements). When the customer is not signed in, `available` MUST be null with reason `NOT_AUTHENTICATED`, and the prices MUST still be returned.

#### Scenario: New customer with one pet

- **WHEN** a signed-in customer with no purchase has one pet eating 200 g a day on 300 g packs, BR plan settings have 10 Starter days and 40 percent, and the plan has one recipe
- **THEN** `starter` has `available: true`, 7 packs of 300 g, `discount_percent` 40, and `food_total` equal to 60 percent of the 7 packs' price

#### Scenario: Two recipes

- **WHEN** the customer chose 50 percent chicken and 50 percent beef and the Starter needs 8 packs
- **THEN** `line_items` has 4 chicken packs and 4 beef packs

#### Scenario: Customer who already bought a Starter

- **WHEN** a customer whose email already has a paid Starter opens the plan
- **THEN** `starter` has `available: false` and `reason` `STARTER_ALREADY_USED`, and `plan_terms` are offered as usual

### Requirement: The checkout sells a Starter as one charge

When the saved plan selection has `plan_kind: "starter"`, `POST /api/v1/onboarding/subscription/checkout` MUST charge the Starter's packs once, with the Starter discount applied only to the food lines. Shipping MUST be charged at the price the market's shipping rules give, with no discount. The first-purchase term discount MUST NOT apply. The Stripe subscription MUST be created to end at its period end, so no later invoice is charged, and the ledger MUST record `plan_kind: "starter"`. The checkout MUST require the Terms and Privacy consent and MUST NOT require the renewal consent. Every other check of the checkout (address, delivery area, CPF and fiscal name in BR, card, critical operation) MUST apply as it does for a plan.

#### Scenario: BR Starter

- **WHEN** a new BR customer checks out a Starter of 7 packs priced R$ 200,00 with R$ 15,00 of shipping and 40 percent off
- **THEN** the first invoice charges R$ 120,00 of food and R$ 15,00 of shipping, the subscription is set to end at its period end, and the ledger row has `plan_kind` `starter`

#### Scenario: Starter without the renewal consent

- **WHEN** a Starter checkout has the Terms and Privacy consent and no `renewal_consent`
- **THEN** the checkout goes on

#### Scenario: Starter without the Terms consent

- **WHEN** a Starter checkout has no `legal_consent`
- **THEN** the API returns 422 `legal_consent_required` and nothing is charged

#### Scenario: No second invoice

- **WHEN** a paid Starter reaches its period end
- **THEN** Stripe does not charge it again and the subscription ends

### Requirement: One Starter per customer

Before any Stripe charge, a Starter checkout MUST be refused with HTTP 409 `starter_already_used` when any of these already has a Starter that is paid, or that is pending for another account: the account email (trimmed, lower case), the CPF (BR, digits only), or the card fingerprint of the payment method on the same Stripe account. A new pet MUST NOT allow another Starter. The delivery address MUST NOT be used to match customers. A checkout that fails or is abandoned before payment MUST NOT block a later Starter by the same customer. Each refusal MUST be logged with the matched key kind (email, CPF, card) and without the value.

#### Scenario: Same email

- **WHEN** a customer whose email has a paid Starter checks out another Starter
- **THEN** the API returns 409 `starter_already_used` and Stripe is not called to charge

#### Scenario: Same CPF, new account

- **WHEN** a new BR account checks out a Starter with a CPF that has a paid Starter on another account
- **THEN** the API returns 409 `starter_already_used`

#### Scenario: Same card, new account

- **WHEN** a new US account checks out a Starter with a card whose fingerprint has a paid Starter on the US Stripe account
- **THEN** the API returns 409 `starter_already_used`

#### Scenario: Same card on the other market

- **WHEN** a card fingerprint has a paid Starter on the BR Stripe account and a new account checks out a US Starter with a card of the same number
- **THEN** the card does not block the US Starter, because each Stripe account has its own fingerprints

#### Scenario: Retry after a declined card

- **WHEN** a customer's Starter checkout was declined and the customer retries with another card
- **THEN** the retry is not refused by the limit

#### Scenario: New pet

- **WHEN** a customer who bought a Starter adds a pet and asks for another Starter
- **THEN** the API returns 409 `starter_already_used`

### Requirement: The Starter is for customers who never bought

A Starter checkout MUST be refused with HTTP 409 `starter_returning_customer`, before any Stripe charge, when the customer has any paid plan before, active or ended. The plan snapshot MUST report the same case as `available: false` with reason `RETURNING_CUSTOMER`.

#### Scenario: Customer who cancelled and returns

- **WHEN** a customer whose monthly plan ended checks out a Starter
- **THEN** the API returns 409 `starter_returning_customer` and the customer can still check out a monthly plan

### Requirement: The admin tells a Starter from a plan

The admin subscription list and detail, the production queue, the courier queue and the UPS label queue MUST include the subscription's `plan_kind` (`subscription` or `starter`). Subscriptions created before this change MUST read as `subscription`.

#### Scenario: Starter in the production queue

- **WHEN** an operator lists the production queue and a paid Starter cycle is in it
- **THEN** its item has `plan_kind` `starter`

#### Scenario: Subscription created before the change

- **WHEN** an operator opens a subscription created before the migration
- **THEN** its `plan_kind` is `subscription`
