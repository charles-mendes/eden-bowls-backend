# Tasks

Needs `starter-box-purchase` implemented first. Sibling changes: `starter-to-monthly` in `eden-bowls-admin` and `eden-bowls`. Deploy the API first.

## 1. Day 1

- [ ] 1.1 Add `src/core/starter-day-one.js` with `starterDayOne({ cycle, shipment, courierDelivery, today, timeZone })`, returning `{ date, source }` or null. Verify with `tests/starter-day-one.test.js`: "US delivery scanned", "Courier did not mark the delivery", "Before delivery", and a confirmation after the expected date replacing it.
- [ ] 1.2 Add migration `1700000000086-add-starter-invite.js` with `invite_sent_at`, `invite_day1`, `invite_day1_source` and `alert_resolved_at` on `starter_box_claims`, and register it in `src/infrastructure/db.js`. Verify with a migration test: DDL and a second run that does nothing.
- [ ] 1.3 Return the `starter` block (`day_one`, `day_one_source`, `monthly_open`, `monthly_subscription_id`, `plan_prefill`) in the subscriptions detail repository and presenter for a Starter, and no block for a plan. Verify with `npx jest --runTestsByPath tests/subscriptions-detail.repository.test.js tests/subscriptions-detail.service.test.js`: "Starter delivered" and a plan without the block.

## 2. Monthly checkout after a Starter

- [ ] 2.1 In `onboarding-discount-eligibility.repository.js`, return `{ eligible: false, reason: 'STARTER_PURCHASED' }` when the user or the email has a paid Starter claim, before the other checks. Verify with `tests/onboarding-discount-eligibility.repository.test.js` (Starter active and Starter ended both give `STARTER_PURCHASED`) and the plan snapshot route test "Plan page after a Starter".
- [ ] 2.2 Leave Starter rows out of `collectSubscribedPetIds` and never reuse a Starter checkout reference for a plan checkout (`checkout-idempotency.js`). Add the 409 `starter_not_delivered` gate with `starterDayOne`. Store the new plan's subscription id on the claim. Verify with `tests/onboarding-subscription-checkout.service.test.js`: "Customer confirms on Day 2" (new subscription, no 409 `checkout_context_mismatch`, no coupon), "Customer tries before delivery", "Monthly after a Starter" and "Direct subscription".

## 3. Day-5 invite

- [ ] 3.1 Add the invite letter (PT and EN) to `src/core/email/transactional-emails.js` and the mailer, with the pets, the Starter days and the link to `/dashboard/plans/:slug`. Add it to the email previews. Verify with the transactional mailer tests and `node src/scripts/render-email-previews.js` producing the invite.
- [ ] 3.2 Add `starter-invite.service.js` and the `starter_invites` hourly job in `background-jobs.service.js`: candidates are paid claims without `invite_sent_at`, with Day 1 + 4 on or before today in the market time zone, without a confirmed plan and not refunded or cancelled; claim, send, record Day 1 and source; 100 per tick, oldest first. Verify with `tests/background-jobs.starter-invites.test.js`: "Delivered and not confirmed", "Customer confirmed on Day 2", "Delivery confirmed after the invite", "One Starter fails" and "Sent from the expected date".

## 4. Today alert

- [ ] 4.1 Count `startersUnconfirmed` per market in the Today counts repository and list each Starter with its customer, expected date and shipment or courier delivery in the Today service, within the actor's market scope. Verify with `npx jest --runTestsByPath tests/today-counts.repository.test.js tests/admin-today.service.test.js`: "Courier did not mark the delivery" and "Delivery confirmed later".

## 5. Docs and integration checks

- [ ] 5.1 In `docs-new/FEATURE_MEDIDAS_CAIXAS/decisoes-starter-box.md`, mark change C as implemented and record the Day 1 rule, the invite day and the Today alert. Verify that the doc names `starter_not_delivered`, `STARTER_PURCHASED` and `starter_invites`.
- [ ] 5.2 Run `npx jest --changedSince=main` and verify every related test passes. Run `npm run routes:manifest` and verify `docs/api-routes.json` has no diff.
