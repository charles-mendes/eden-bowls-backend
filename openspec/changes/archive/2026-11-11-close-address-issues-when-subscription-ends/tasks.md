# Tasks

## 1. The rule in the repository

- [x] 1.1 Add `closeEnded({ subscriptionId = null, now })` to `DeliveryAddressIssuesRepository`: one `UPDATE ... JOIN stripe_subscriptions` closing open problems of `canceled` subscriptions with no paid cycle (`paid_at IS NOT NULL AND paid_invoice_id IS NOT NULL`) whose box has not left (courier `out_for_delivery`/`delivered`, UPS `created`/`delivered`, `COLLATE utf8mb4_unicode_ci` as in `listMarketExceptions`), setting `resolved_by = 'ended'`. Take table names as constructor options and return the affected row count. Verify with the unit test of the issues repository (create it if missing) asserting the SQL and params, with and without `subscriptionId`.
- [x] 1.2 Cover the rule in `tests/integration/delivery-address-issues.integration.test.js`: canceled + delivered → closed `ended`; canceled + paid cycle with no delivery → open; canceled + only failed delivery → open; canceled + UPS `created` → closed; canceled + delivered + one unpaid cycle → closed; active + delivered → open. Insert ledger rows with `status = 'canceled'`, as `mapStripeStatus` writes them, never `incomplete_expired`. Verify with `RUN_DB_INTEGRATION_TESTS=true npx jest --runTestsByPath tests/integration/delivery-address-issues.integration.test.js`.

## 2. Service and call sites

- [x] 2.1 Add `closeIfEnded(subscriptionId)` to `DeliveryAddressIssueService`. It calls the repository with `this.now()`, sends no email, logs its errors and never throws. Verify with `npx jest --runTestsByPath tests/delivery-address-issue.service.test.js` (closes, no mailer call; repository error logged and swallowed).
- [x] 2.2 Call it from `StripeWebhookService.handleSubscriptionChanged` after the ledger `upsert`, with the ledger id. Verify with `npx jest --runTestsByPath tests/stripe-webhook.service.test.js` (a `customer.subscription.deleted` calls `closeIfEnded` with the ledger id; no service wired → no error).
- [x] 2.3 Call it from `CourierDeliveryService.dispatch` after the insert. Verify with `npx jest --runTestsByPath tests/courier-delivery.service.test.js` (called on success, not on a refused dispatch).
- [x] 2.4 Call it from `UpsShipmentService` after `markCreated` succeeds. Verify with `npx jest --runTestsByPath tests/ups-shipment.service.test.js`.

## 3. Deploy

- [x] 3.1 Add migration `1700000000072-close-address-issues-of-ended-subscriptions` running the same `UPDATE` with no subscription filter and a no-op `down`, and register it in `src/infrastructure/db.js` after `AddSubscriptionCheckoutSnapshot1700000000071`. Verify with a new `tests/address-issues-ended.migration.test.js`, following `tests/subscription-checkout-snapshot.migration.test.js`.
- [x] 3.2 Run `npm run migrate` on the local QA database (the one that has problem 1) and verify that problem 1 (subscription 179) has `open_key` null and `resolved_by = 'ended'`, and that Today no longer shows "1 problema de endereço aberto".

## 4. Specs

- [x] 4.1 Run `npx jest --changedSince=main` and verify it passes, then `openspec validate close-address-issues-when-subscription-ends --strict`. Archive together with the panel change of the same name.
