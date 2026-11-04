# Tasks

## 1. Stage dates

- [ ] 1.1 Add migration `1700000000062` with `in_transit_at` and `out_for_delivery_at` on `ups_shipments`, register it in `db.js`, and map both in `mapRow`; verify with a migration test and by applying it locally.
- [ ] 1.2 Store the first date of each stage in `recordTracking` with `COALESCE`, using the UPS delivery time for delivered; verify repository tests cover normal progress, a stage passed between reads, an exception, and a repeated read that keeps the first date.
- [ ] 1.3 Add a pure helper that builds the four stages and the warning from a shipment row; verify unit tests cover each stage, a skipped stage, an exception, and a resolved exception.

## 2. Shipped letter on pickup

- [ ] 2.1 Add `UpsShipmentService.recordTracking` that stores the read and sends the shipped letter once the shipment reaches in transit or later, and use it from `runUpsTracking` and `refreshTracking`; verify tests show no letter for label created or exception, one letter for in transit and for a first read of delivered, and none for a voided label.
- [ ] 2.2 Stop sending the letter in `createForSubscription`; verify the label purchase test asserts no mail.
- [ ] 2.3 Verify a job test where the mailer throws keeps the stored tracking, and a test where the letter was already claimed sends nothing.

## 3. Label queue API

- [ ] 3.1 Add the repository read for US ledger rows with a paid invoice and their active label, capped at 100 with `truncated`; verify tests cover ready, created, voided, delivered, and Brazil rows.
- [ ] 3.2 Add `GET /api/v1/admin/shipments/queue` with `shipping.read` and market scope, returning `ready` with `issues` from `inspectLabel` and `created`; verify route tests cover a ready order, a P.O. Box order, a Brazil-scoped actor, and a missing permission.
- [ ] 3.3 Run `npm run routes:manifest`, commit `docs/api-routes.json`, and verify `npx jest --runTestsByPath tests/api-routes-manifest.test.js` passes.

## 4. Store timeline

- [ ] 4.1 Return `label_created_at`, `in_transit_at`, `out_for_delivery_at`, and `tracking_description` per charge in `subscriptions-detail.repository.js`; verify with `tests/subscriptions-detail.repository.test.js`.
- [ ] 4.2 Show the four-stage timeline with dates, the warning, and the UPS link in `PlanDetail.tsx`, with PT and EN texts, and hide it for voided labels; verify with `npx vitest run src/pages/dashboard/pages/PlanDetail.test.tsx`.

## 5. Admin label queue

- [ ] 5.1 Run `npm run contract:sync` in the admin panel and commit `contracts/backend-routes.json`; verify the contract test passes.
- [ ] 5.2 Add `printLabels(blobs)` in `src/lib/printLabel.ts`, one 4x6 page per label, and make `printLabel` use it; verify with a Vitest test of the built document for one and three labels.
- [ ] 5.3 Add the label queue page and menu entry: ready and created lists, blocked reasons, selection, confirmation, a per-order loop over the create route, a result per order, one print job for the created labels, and a link to the subscription detail; verify Vitest tests cover a full batch, one failure, an order that already had a label, no confirmation, and printing created labels only.

## 6. Integration

- [ ] 6.1 On local CIE, buy two labels from the queue, print them in one job, and confirm no shipped letter reaches Mailpit until a refresh reads the box moving; then confirm the store shows the timeline. Void the test labels afterwards.
- [ ] 6.2 Run `npx jest --changedSince=main` in the backend and the related Vitest files in the admin panel and the store.
