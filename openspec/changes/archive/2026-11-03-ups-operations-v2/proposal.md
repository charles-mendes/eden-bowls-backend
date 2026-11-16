# Proposal

## Why

Labels are bought one at a time inside each subscription, so a day with many US orders means opening every subscription. The shipped letter goes out when the label is bought, before UPS has the box. In the store, a customer sees only the tracking number and the last UPS status.

## What Changes

- New label queue in the admin panel. It lists paid US orders without a label, purchases still unresolved in UPS, and labels already created, with the production and subscription status of each. The operator selects several, confirms, and the queue buys the missing labels, one active label per invoice. All created labels print together as 4x6 pages, and a failed purchase is named without stopping the rest.
- Voiding a label, fixing an address, and reprinting a single label stay in the subscription detail. Voiding asks for confirmation, and a purchase with no confirmed UPS outcome can be closed there after the operator checks UPS.
- APO, FPO, and DPO addresses are refused for UPS labels.
- Each shipment stores the first UPS scan date of four stages: label created, in transit, out for delivery, delivered. Out for delivery is read from the UPS scan code, and a return to shipper becomes a warning.
- The store shows those four stages as a delivery timeline. A UPS problem shows as a warning on the current stage. The UPS tracking link stays.
- **BREAKING (customer email timing):** the shipped letter goes out on the first tracking read that shows the box moving, not when the label is bought. It is still sent once per shipment, to the customer email the order letter uses, and a failed send is tried again on the next tracking read.
- Out of scope: dry ice and the `quote_mode=ups` production gate. They wait for the answer from UPS and get their own change. Also out of scope: Brazil delivery operations and labels for $0 invoices.

## Capabilities

### New Capabilities

- `ups-label-queue`: which US orders are ready for a label, buying several labels in one action, and printing them together.
- `delivery-tracking`: the delivery stages a shipment reaches, their dates, and how the store shows them.

### Modified Capabilities

- `transactional-emails`: "Shipment letter stays on US tracking" now sends the letter when tracking first shows the box moving.
- `background-jobs`: "In-transit UPS shipments refresh tracking" now records stage dates and can send the shipped letter.

## Impact

- Backend: migration `1700000000062` on `ups_shipments`, `src/core/ups-tracking.js`, `src/infrastructure/repositories/ups-shipment.repository.js`, `src/services/ups-shipment.service.js`, `src/services/background-jobs.service.js`, `src/infrastructure/repositories/subscriptions-detail.repository.js`, `src/api/routes/admin.routes.js`. New route `GET /api/v1/admin/shipments/queue`, so `docs/api-routes.json` changes.
- Admin panel: new label queue page and menu entry, void confirmation and the confirmed close of unresolved rows in `SubscriptionDetailPage.tsx` (task 5.3 of `ups-environment-guard`), multi-page printing in `src/lib/printLabel.ts`, `contracts/backend-routes.json`.
- Store: delivery timeline in `src/pages/dashboard/pages/PlanDetail.tsx`, PT and EN texts.
- Customers: the shipped letter arrives later, at pickup. Labels bought before the deploy already had their letter, and no second one is sent.
