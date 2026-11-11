# Design

## Context

The checkout already has an express consent for terms and privacy (legal-documents). The validator `onboarding-subscription-checkout.validator.js` refuses anything but a literal `legal_consent.accepted: true` with 422 `legal_consent_required`. `OnboardingSubscriptionCheckoutService.recordLegalConsent` calls `privacyService.recordCheckoutConsents` before Stripe, and a failure answers 503 `legal_consent_unavailable`. Consents are rows of `consent_type`, `status`, `document_version` (32 characters), `source`, `ip_hash` and `user_agent`.

## Goals / Non-Goals

**Goals:**
- The renewal acceptance follows the same path and the same guarantees as the terms acceptance: refused without it, recorded before the charge, every retry recorded.

**Non-Goals:**
- Storing the amounts shown. The term, the monthly price and the first-invoice discount belong to the Stripe subscription that the same checkout creates. The consent row records who accepted, when, from where, and which text version.
- The edit flow, the renewal email and the renewal switch (see proposal).

## Decisions

1. **A separate `renewal_consent` object, not a second flag inside `legal_consent`.** The store shows two boxes, and each refusal needs its own code and message. The literal-`true` check is copied from `legal_consent`.
2. **Order of checks: `legal_consent` first, then `renewal_consent`.** Clients without either keep getting `legal_consent_required`, the answer they get today.
3. **`document_version` holds the text version the store sends, or `checkout-v1`.** The renewal text is checkout copy, not a published legal document, so it is not looked up in `legal_documents`, and an unknown version is recorded as sent.
4. **Recorded inside `recordCheckoutConsents`.** It gains `renewalVersion` and writes the third row after `terms`, so one call keeps "all three or 503".

## Risks / Trade-offs

- [A store build without the field gets 422] → Release the store change in the same deploy. QA only, no production traffic.
- [Two of three consents written before a failure] → The 503 stops the charge. The trail keeps the partial rows, as it already does for the terms pair, and the retry writes all three.

## Migration Plan

No migration. Deploy the API and the store together. Rollback: revert both.
