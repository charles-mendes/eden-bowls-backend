# Tasks

## 1. Tracking stages

- [x] 1.1 Add migration `1700000000062` with `in_transit_at`, `out_for_delivery_at`, and `shipped_letter_sent_at` in the raw-SQL form of 059, backfill `shipped_letter_sent_at` from `shipped_at` on created and delivered rows, add a `down`, register it in `db.js`, and map the columns in `mapRow`; verify with a migration test for up, a second up, and down, and by applying it locally.
- [x] 1.2 Map every activity in `parseUpsTracking` to a stage, with `OF`/`072` as out for delivery, `RS` and `X` as warnings, and `SDD` ignored, returning the earliest scan date per stage; verify `tests/ups-tracking.test.js` covers "Loaded on Delivery Vehicle" with `SDD`, `RS` after in transit, a delivered read with earlier scans, scans in any order, and the English fallback.
- [x] 1.3 Store the first date of each stage in `recordTracking` with `COALESCE`; verify repository tests cover normal progress, a repeated read that keeps the first date, a warning that writes no date, and a failed read.
- [x] 1.4 Add a pure helper that builds the four stages, the current stage, the latest description, and the warning from a row; verify unit tests cover each stage, a skipped stage, an exception, `RS`, a resolved warning, and a hub scan after out for delivery.

## 2. Shipped letter on pickup

- [x] 2.1 Add `UpsShipmentService.recordTracking` that stores the read and sends the letter to the ledger `customerEmail` once the row reaches in transit or later, setting `shipped_letter_sent_at` on a sent or already-sent claim, and use it from `runUpsTracking` and `refreshTracking`; verify tests show no letter for label created or a warning, one letter for in transit and for a first read of delivered, none for a voided row, and a logged skip without a customer email.
- [x] 2.2 Stop sending the letter in `createForSubscription`; verify the purchase test asserts no mail.
- [x] 2.3 In `runUpsTracking`, retry only the letter for delivered rows with no `shipped_letter_sent_at` and `delivered_at` within 7 days, and log `scanned`, `updated`, `failed`, and `mailed`; verify job tests where SMTP throws on the first in-transit read and the next read sends one letter, where the first read is delivered and the next tick sends it without a UPS call, and where a row 8 days after delivery is not tried.
- [x] 2.4 Verify a test where a refresh and a tick read the first moving scan together produces one SMTP call, and one where the letter was sent at purchase makes no SMTP call.

## 3. Label queue API

- [x] 3.1 Add `military_address_not_supported` to `inspectLabel` for APO, FPO, and DPO; verify a service test refuses a single purchase with that code.
- [x] 3.2 Add the repository read for paid US cycles with a delivery date no older than 30 days and their active label, with customer name, city, ZIP, production status, subscription status, and delivery date, capped at 100 with `truncated`; verify tests cover ready, two paid cycles of one subscription, pending, unknown, created, voided, delivered, an old cycle, a paused subscription, and a Brazil row for a global admin.
- [x] 3.3 Add `GET /api/v1/admin/shipments/queue` with `shipping.read` and market scope, returning `ready` with `issues`, `unresolved`, and `created`; verify route tests cover a ready order, a P.O. Box order, an unknown row, a Brazil-scoped actor, and a missing permission.
- [x] 3.4 Run `npm run routes:manifest`, commit `docs/api-routes.json`, and verify `npx jest --runTestsByPath tests/api-routes-manifest.test.js` passes.
- [x] 3.5 Verify service tests for two simultaneous purchases on one invoice (one UPS call, the other reuses or gets 409, no second row), a timeout after UPS answered (row unknown, a later purchase gets 409), and `markCreated` failing after the purchase (row kept, UPS id logged).

## 4. Store timeline

- [x] 4.1 Return `label_created_at`, `in_transit_at`, `out_for_delivery_at`, and `tracking_description` per charge in `subscriptions-detail.repository.js`; verify with `tests/subscriptions-detail.repository.test.js`.
- [x] 4.2 Show the four-stage timeline with dates, the latest description, the warning, and the UPS link in `PlanDetail.tsx`, with PT and EN texts, and nothing for voided labels; verify with `npx vitest run src/pages/dashboard/pages/PlanDetail.test.tsx`.

## 5. Admin panel

- [x] 5.1 Run `npm run contract:sync` in the admin panel and commit `contracts/backend-routes.json`; verify the contract test passes.
- [x] 5.2 Add `printLabels(blobs)` in `src/lib/printLabel.ts`, one 4x6 page per label, and make `printLabel` use it; verify `src/lib/printLabel.test.ts` covers one and three labels.
- [x] 5.3 In the subscription detail, confirm before voiding, show pending and unknown rows, and offer the close that sends `confirm_not_created: true`; add the military address text to `labelIssueText`; verify `SubscriptionDetailPage.test.tsx` covers the confirmation and the close. This covers task 5.3 of `ups-environment-guard`.
- [x] 5.4 Add the label queue page and menu entry: ready, unresolved, and created lists with name, city, ZIP, both statuses, and delivery date; blocked reasons; selection; confirmation, with a second one naming orders not `ready` or not active; a disabled button during the loop; one result per order (created, already had a label, in progress, failed); one print job for every created label of the selection; missing files named; and a link to the subscription detail; verify Vitest tests cover a full batch, a middle 409, a 502 unknown, an order that already had a label, no confirmation, the extra confirmation, a missing file, and printing created labels only.

## 6. Integration

- [x] 6.1 On local CIE, buy two labels from the queue, print them in one job, and confirm Mailpit has no shipped letter until a refresh reads delivered, then exactly one; confirm the store shows the timeline. Void the test labels afterwards. CIE only answers delivered, so the middle stages rest on the unit tests from 1.2. Done on 2026-11-03 with the one ready local order: one page printed, no letter until the refresh, then one letter and none on a second refresh, and the store timeline matched. CIE marks the label delivered, so it was removed locally instead of voided.
- [x] 6.2 Run `npx jest --changedSince=main` in the backend and the related Vitest files in the admin panel and the store.
