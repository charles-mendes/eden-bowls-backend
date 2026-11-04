# Tasks

Prerequisite: change `delivery-recipient-name` is implemented, so `recipient_name` exists in subscription addresses and the production queue presenter reads it.

## 1. Storage

- [x] 1.1 Add migration `courier_deliveries` with the columns from design.md. Add the stored generated `active_invoice_key` and its unique index with raw SQL, following `1700000000030-add-ups-shipments-active-invoice-unique.js` (an `information_schema` check, no TypeORM `getTable()`). Add indexes on `subscription_id` and `(status, out_for_delivery_at)`. Verify with a `RUN_DB_INTEGRATION_TESTS=true` migration test: two active rows for one invoice fail; failed plus active, and canceled plus active, succeed.
- [x] 1.2 Add `CourierDeliveryRepository`: an insert that maps `ER_DUP_ENTRY` to `{ inserted: false }`; find by id, list by subscription, list by invoice ids, list by status, list delivered since; and conditional `transition(id, toStatus, fields)` (`WHERE status = 'out_for_delivery'`) and `updateDetails` (`WHERE status <> 'canceled'`), each returning affected rows. Verify with `tests/courier-delivery.repository.test.js` asserting the SQL guards.

## 2. Domain rules

- [x] 2.1 Add `src/core/courier-timeline.js` (stages `preparing`, `out_for_delivery` and `delivered`; a `failed` warning; canceled ignored; `tracking_number` null) and add `carrier: 'ups'` to `deliveryTimeline`. Verify with `tests/courier-timeline.test.js` covering the store scenarios, and with `npx jest --findRelatedTests src/core/delivery-timeline.js` staying green.
- [x] 2.2 Add `src/core/courier-fields.js` with the tracking URL, cost, courier name and note rules from design.md. Verify with tests: `https://trip.uber.com/abc123` accepted; `http://`, credentials, `javascript:`, no scheme and 501 chars refused; `18.50` → 1850; `-1` and `18.555` refused.
- [x] 2.3 Add `CourierDeliveryService.dispatch`: the BR address check, invoice ownership, the paid and charged-delivery checks, field validation, the readiness 409 with `confirm_not_ready`, and 409 `courier_delivery_active`. Verify with `tests/courier-delivery.service.test.js` covering the "Only a paid Brazil delivery", "Dispatch records", "One active delivery" (including a new dispatch after a cancel) and "Dispatching an order that is not ready" scenarios.
- [x] 2.4 Add `markDelivered`, `markFailed`, `cancel` and `updateDetails` on the conditional repository calls: zero rows gives 409 `courier_delivery_final`; delivered satisfies `out_for_delivery_at <= delivered_at <= now`; failed requires a reason; editing a canceled row gives 409. Verify with service tests for every "Status moves only forward" and "Details can be corrected" scenario, including two completions racing (one success, one 409) and a repeated delivered.
- [x] 2.5 Record an audit entry for each action through `auditService.record` (`courier_delivery.dispatch`, `.delivered`, `.failed`, `.cancel` and `.update`). Verify that the service tests assert the audit payload, including the failure reason.

## 3. Queue and admin routes

- [x] 3.1 Add `listPaidCourierCycles` to the ledger repository (address country BR, paid, a 30-civil-day floor in `America/Sao_Paulo`). Add `CourierDeliveryService.listQueue`, which builds "to dispatch" from it and the other three groups from `courier_deliveries` with no floor (delivered: last 7 civil days in São Paulo). Show the recipient by the design rule. Verify with service tests for every queue scenario: the 31-day-old cycle, out for delivery for 40 days, the 40-day-old failure, failed then re-dispatched, the 6- and 8-day delivered rows, recipient set, and the old subscription fallback. Add a repository test asserting that the SQL filters BR by address.
- [x] 3.2 Register the routes from design.md in `admin.routes.js` with `shipping.read`/`shipping.write`, the market scopes and a validator. Verify with `tests/admin-courier-deliveries.routes.test.js`: 403 without `shipping.write`, an empty queue for US-only staff, 404 across markets, the 409 `reasons` payload reaching the response, and the happy path.
- [x] 3.3 Wire the service in `src/index.js`, run `npm run routes:manifest`, and commit `docs/api-routes.json`. Verify that `npx jest --runTestsByPath tests/api-routes-manifest.test.js` passes.

## 4. Letters

- [x] 4.1 Add designer files `new-designer-emails/{pt,en}/courier-out-for-delivery.html` and `courier-delivered.html` derived from `shipped.html`, then the templates `courier_out_for_delivery` and `courier_delivered` (with the tracking link when present, and the greeting from `firstNameFrom`) and their preview fixtures. Verify with template tests rendering both locales, with and without a link, and asserting the recipient name is not used.
- [x] 4.2 Add `notifyCourierOutForDelivery` and `notifyCourierDelivered` to the mailer, claimed by the courier row id. Call them from the service only after a successful write, without throwing and with no retry. Verify with tests: a second attempt sends again, an edit sends nothing, a failure sends nothing, the race loser sends nothing, and an SMTP failure keeps the status and logs it.

## 5. Customer detail

- [x] 5.1 Attach the courier timeline and `tracking_url` (with `tracking_number` null) to the `billing_history` rows of Brazil invoices in `subscriptions-detail.repository.js`, without exposing method, cost, note, reason or staff. Verify with `tests/subscriptions-detail.repository.test.js` cases for on the road with a link, failed, and paid with no delivery.

## 6. Panel (`eden-bowls-admin`)

- [x] 6.1 Run `npm run contract:sync` and commit `contracts/backend-routes.json`. Verify that the contract Vitest passes.
- [x] 6.2 Add the "Entregas Brasil" page with four tabs, the dispatch modal with the readiness re-confirmation driven by the 409 `reasons`, and the delivered, failed and cancel actions, hidden without `shipping.write`. Verify with a Vitest page test covering dispatch, the confirmation, failure with a reason, a 409 `courier_delivery_final` message, and the read-only view.
- [x] 6.3 Show the recipient and the courier section in `SubscriptionDetailPage` when the subscription does not ship with UPS. Verify with a Vitest case for a BR subscription with a failed attempt and a delivered one.

## 7. Store (`eden-bowls`)

- [x] 7.1 Render the courier timeline in the plan history: the `preparing` stage, the `failed` warning with its own text, and a tracking-link branch that does not depend on `trackingCode`. Add pt-BR and en-US texts. Verify with Vitest cases for the store scenarios, including a link with no tracking code, and an unchanged UPS case.

## 8. Integration check

- [x] 8.1 In the local environment, pay a BR cycle, dispatch it from the panel, mark it failed, dispatch again, and mark it delivered. Verify the queue groups, the store timeline and link at each step, the two out-for-delivery letters and one delivered letter in the mail catcher, and the audit entries.
