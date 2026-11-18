# Tasks

Sibling changes: `starter-box-purchase` in `eden-bowls-admin` and `eden-bowls`. Deploy the API first. Follow-up change: `starter-to-monthly`.

## 1. Schema and settings

- [ ] 1.1 Add migration `1700000000085-add-starter-box.js`: `plan_settings.starter_days` (INT, 10) and `starter_discount_percent` (INT, 40); `stripe_subscriptions.plan_kind` (VARCHAR(16), default `subscription`); table `starter_box_claims` with indexes on `email_normalized`, `tax_document`, (`stripe_account`, `card_fingerprint`) and `user_id`. Register it in `src/infrastructure/db.js`. Verify with a migration test: the DDL, the defaults in both markets, existing ledger rows reading `subscription`, and a second run that does nothing.
- [ ] 1.2 Read and save the Starter values in the plan settings repository, service and validator, as `starterDays` and `starterDiscountPercent` next to `planDays` and `largePackLimit` (`PUT /api/v1/admin/catalog/plan-settings`), with 422 `starter_days_invalid` and `starter_discount_percent_invalid`. Verify with `npx jest --findRelatedTests src/services/plan-settings.service.js`: "Values after deploy", "Operator changes the US percent" and "Days out of range".

## 2. Starter offer in the plan

- [ ] 2.1 In `src/core/simplified-consumption.js`, add a pure Starter pack calculation: same pack size as the monthly plan, pack count = ceil(daily grams × Starter days / pack size), split across recipes like the monthly plan. Verify with a unit test: "New customer with one pet" (7 packs of 300 g for 200 g a day) and "Two recipes" (4 + 4).
- [ ] 2.2 Add a `starterEligibility(userId)` function (claims by email and CPF on file, returning customer from the ledger and old orders) and return `starter` in the plan snapshot (`GET /api/v1/onboarding/plan/snapshot`) with prices from the catalog. Accept `plan_kind` (`subscription` | `starter`) in the plan selection validator and store it. Verify with the plan snapshot and plan selection route tests: available offer, `STARTER_ALREADY_USED`, `RETURNING_CUSTOMER`, `NOT_AUTHENTICATED` with prices.

## 3. Starter checkout

- [ ] 3.1 In `OnboardingSubscriptionCheckoutService.checkout`, branch on `plan_kind: starter`: skip `renewal_consent` and the first-purchase promotion, read the card fingerprint with `paymentMethods.retrieve`, run the limit (409 `starter_already_used`, 409 `starter_returning_customer`), insert the `pending` claim, and price the Starter lines. Log refusals with the key kind only. Verify with `tests/onboarding-subscription-checkout.service.test.js`: "Same email", "Same CPF, new account", "Same card, new account", "Same card on the other market", "Retry after a declined card", "New pet", "Customer who cancelled and returns", "Starter without the renewal consent", "Starter without the Terms consent", "US Starter with charges off" (the Starter checkout goes through `chargedShipping`, so a US Starter with `charge_shipping` off has no shipping line; scenario of `us-company-paid-shipping`), and that no Stripe charge call happens on a refusal.
- [ ] 3.2 In `stripe-billing-client.js`, create the Starter subscription with `cancel_at_period_end: true`, metadata `plan_kind: starter`, and the Starter coupon from `stripe-coupon.service.js` (found or created per account, percent and food product set, `applies_to.products`, `duration: once`). Verify with `tests/stripe-billing-client.test.js` (request body has the coupon, the flag and the metadata; shipping stays in `add_invoice_items`) and a coupon service test for reuse and a new product set. In Stripe test mode, check that a plan checkout with the current first-purchase coupon does or does not discount the shipping line, and write the result in this change's notes.
- [ ] 3.3 Store `plan_kind`, `auto_renew: false` and term 1 in the ledger for a Starter. On `invoice.paid` of a Starter, turn its claim `paid` and skip `endContractAfterLastDelivery`. On a failed creation or an expired incomplete subscription, turn it `void`. Verify with `tests/stripe-webhook.service.test.js`: claim paid on payment, claim void on `incomplete_expired`, and "No second invoice" (no contract-end call for a Starter).

## 4. Admin and letters

- [ ] 4.1 Add `plan_kind` to the admin subscription list and detail presenters, the production queue item, the courier queue item and the UPS label queue item. Verify with `npx jest --findRelatedTests src/core/production-queue-presenter.js src/services/courier-delivery.service.js` and the admin subscription route tests: "Starter in the production queue" and "Subscription created before the change".
- [ ] 4.2 In the transactional mailer, skip the cancelled letter for a Starter and use a Starter variant of the order-confirmed letter (PT and EN copy in `src/core/email/transactional-emails.js`, with the Starter days and "no automatic monthly charge"). Update the email previews. Verify with the transactional email tests: "Starter is created" and "Starter period ends", and `node src/scripts/render-email-previews.js` producing the Starter letter.
- [ ] 4.3 Exclude `plan_kind` `starter` from both plan notices in `plan-notices.service.js` and from the dashboard notice. Verify with `npx jest --runTestsByPath tests/plan-notice.test.js tests/background-jobs.plan-notices.test.js`: "Starter inside the notice window".

## 5. Docs and integration checks

- [ ] 5.1 In `docs-new/FEATURE_MEDIDAS_CAIXAS/decisoes-starter-box.md`, mark change B as implemented and record the Starter model (one-charge subscription), the limit keys and the error codes. Verify that the doc names `starter_box_claims`, `starter_already_used` and `starter_returning_customer`.
- [ ] 5.2 Run `npx jest --changedSince=main` and verify every related test passes. Run `npm run routes:manifest` and verify `docs/api-routes.json` has no diff.
