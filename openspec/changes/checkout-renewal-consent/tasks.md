# Tasks

Sibling change in `eden-bowls`: `checkout-renewal-consent`. Deploy both together.

## 1. Required acceptance

- [x] 1.1 In `src/api/validators/onboarding-subscription-checkout.validator.js`, add `renewal_consent: { accepted: unknown, version: string ≤ 32 }`. After the `legal_consent` check, refuse anything but a literal `true` with 422 `renewal_consent_required` ("Accepting the automatic renewal is required."), and return `renewal_consent: { accepted: true, version }`. Mirror the guard in `OnboardingSubscriptionCheckoutService.checkout`. Verify with the checkout validator and service tests (`npx jest --findRelatedTests src/api/validators/onboarding-subscription-checkout.validator.js`): the scenarios "Renewal box not ticked", "Old client without the field" and "Both boxes missing", each without a Stripe call.

## 2. Recorded before charging

- [x] 2.1 `PrivacyService.recordCheckoutConsents` takes `renewalVersion` and records a `granted` `auto_renewal` consent with source `checkout` after `terms`, with `document_version` set to the version or `checkout-v1`. `recordLegalConsent` in the checkout service passes `payload.renewal_consent.version`. Verify with `npx jest --findRelatedTests src/services/privacy.service.js src/services/onboarding-subscription-checkout.service.js`: "Accepted checkout" (three rows before Stripe, version `2026-11-10`), "Refused by another validation" (no row) and "Consent trail unavailable" (503, no Stripe call).
- [x] 2.2 Update fixtures and tests that post a checkout so that they send `renewal_consent`, including route tests and e2e helpers. Verify with `npx jest --changedSince=HEAD`.

## 3. Integration checks

- [x] 3.1 Run `npx jest --changedSince=main` and verify every related test passes. Run `npm run routes:manifest` and verify `docs/api-routes.json` has no diff.
