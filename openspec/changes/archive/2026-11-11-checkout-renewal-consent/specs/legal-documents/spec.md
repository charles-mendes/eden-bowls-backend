## ADDED Requirements

### Requirement: Checkout requires accepting automatic renewal

`POST /api/v1/onboarding/subscription/checkout` MUST require `renewal_consent.accepted` to be `true`. Otherwise the API MUST answer HTTP 422 `renewal_consent_required` and MUST NOT create or reuse a Stripe subscription, charge the customer or record a consent. `renewal_consent.version` is an optional string of at most 32 characters. The check MUST run with the `legal_consent` check, before any other checkout step.

#### Scenario: Renewal box not ticked

- **WHEN** a customer posts a checkout with `legal_consent.accepted` `true` and `renewal_consent.accepted` `false`
- **THEN** the API answers 422 `renewal_consent_required` and Stripe is not called

#### Scenario: Old client without the field

- **WHEN** a client posts a checkout without `renewal_consent`
- **THEN** the API answers 422 `renewal_consent_required`

#### Scenario: Both boxes missing

- **WHEN** a client posts a checkout without `legal_consent` and without `renewal_consent`
- **THEN** the API answers 422 `legal_consent_required`, as before this change

### Requirement: Checkout records the renewal acceptance before charging

Each checkout request that passes the checkout validations MUST record a `granted` consent of type `auto_renewal` with source `checkout`, the customer, the hashed IP, the user agent and the version the client sent (or `checkout-v1` without one), together with the `privacy_policy` and `terms` consents and before the Stripe subscription is created or reused. A retry of the same checkout MUST record it again. If it cannot be recorded, the checkout MUST fail with HTTP 503 `legal_consent_unavailable` and MUST NOT charge.

#### Scenario: Accepted checkout

- **WHEN** a customer completes a checkout with both boxes ticked and `renewal_consent.version` `2026-11-10`
- **THEN** the consent trail holds `privacy_policy`, `terms` and `auto_renewal` consents with source `checkout`, and the `auto_renewal` one records `2026-11-10`, all created before the Stripe subscription

#### Scenario: Refused by another validation

- **WHEN** a checkout with both boxes ticked is refused because the delivery area is not verified
- **THEN** no `auto_renewal` consent is recorded

#### Scenario: Consent trail unavailable

- **WHEN** recording the `auto_renewal` consent fails
- **THEN** the API answers 503, no Stripe subscription is created or reused and the customer is not charged
