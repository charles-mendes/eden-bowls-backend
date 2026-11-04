# Proposal

## Why

Labels are bought one at a time inside each subscription, so a day with many US orders means opening every subscription. The shipped letter goes out when the label is bought, before UPS has the box. In the store, a customer sees only the tracking number and the last UPS status.

## What Changes

- New label queue in the admin panel. It lists US orders ready for a label and labels already created. The operator selects several, confirms, and the queue buys the missing labels, one active label per invoice. All created labels print together as 4x6 pages, and a failed purchase is named without stopping the rest.
- Voiding a label, fixing an address, and reprinting a single label stay in the subscription detail.
- Each shipment stores the first date it reached each of four stages: label created, in transit, out for delivery, delivered.
- The store shows those four stages as a delivery timeline. A UPS problem shows as a warning on the current stage. The UPS tracking link stays.
- **BREAKING (customer email timing):** the shipped letter goes out on the first tracking read that shows the box moving, not when the label is bought. It is still sent once per shipment.
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
- Admin panel: new label queue page and menu entry, multi-page printing in `src/lib/printLabel.ts`, `contracts/backend-routes.json`.
- Store: delivery timeline in `src/pages/dashboard/pages/PlanDetail.tsx`, PT and EN texts.
- Customers: the shipped letter arrives later, at pickup. Labels bought before the deploy already had their letter, and no second one is sent.
