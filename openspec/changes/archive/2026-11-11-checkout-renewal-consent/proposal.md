# Proposal

## Why

Plans of 1, 3 and 6 months are charged monthly and renew automatically at the end of the term. The store checkout says nothing about the renewal: only the card form mentions a "recurring charge". The client decided (docs-new/FEATURE_MEDIDAS_CAIXAS/eden-bowls-starter-box-e-assinaturas.md, section 4) that the checkout must state duration, amounts, billing frequency and automatic renewal, with express acceptance. The renewal email 7 days before and the customer's switch to turn renewal off already exist.

## What Changes

- **BREAKING (checkout payload):** `POST /api/v1/onboarding/subscription/checkout` requires `renewal_consent.accepted` to be `true`, next to the existing `legal_consent`. Otherwise it answers 422 `renewal_consent_required` and does not charge. `renewal_consent.version` is an optional string of at most 32 characters: the version of the renewal text the store showed.
- An accepted checkout records an `auto_renewal` consent (source `checkout`, version, hashed IP, user agent) together with the terms and privacy consents, before the Stripe subscription is created or reused. A failed record answers 503 and does not charge.
- No new route. No change to the renewal email (`plan_notice_days` is already 7 on deploy) or to the customer's renewal switch.
- Out of scope: the subscription edit (`/subscriptions/:id/edit/commit`). A term change there also starts a new contract and gets its own change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `legal-documents`: the checkout also requires and records the acceptance of automatic renewal.

## Impact

- `src/api/validators/onboarding-subscription-checkout.validator.js`, `src/services/onboarding-subscription-checkout.service.js`, `src/services/privacy.service.js`.
- The store sends `renewal_consent` in the same release: sibling change `checkout-renewal-consent` in `eden-bowls`. An old store build is refused with 422 until it is deployed. There is no production traffic yet.
- `docs/api-routes.json` does not change.
