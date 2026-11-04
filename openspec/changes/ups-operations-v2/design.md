# Design

## Context

- `ups_shipments` already keeps `shipped_at` (set when the label is bought), `tracking_status`, `tracking_description`, `delivered_at`, and `tracking_checked_at` (migration 059). `parseUpsTracking` in `src/core/ups-tracking.js` maps a read to `label_created`, `in_transit`, `out_for_delivery`, `delivered`, `exception`, or `unknown`.
- `recordTracking` is called by the tracking job (`runUpsTracking`) and by `UpsShipmentService.refreshTracking`. Neither sends mail.
- `UpsShipmentService.createForSubscription` buys one label per invoice, checks that the invoice is paid and belongs to the subscription, reuses an active label, and then calls `notifyShippedMail`.
- `notifyShipped` claims by template `shipped` and the shipment id, so a second call for the same shipment sends nothing.
- `inspectLabel` returns every reason that blocks a label: country, P.O. Box, incomplete address, missing ship-from, missing recipient name.
- The admin dashboard counts orders without a label from the production queue (`admin-today.service.js`). Single-label printing lives in `src/lib/printLabel.ts` in the admin panel.
- The active change `ups-environment-guard` adds the `ups-shipments` capability, which is not yet a main spec. This change uses new capabilities so the two can be archived in either order.

## Goals / Non-Goals

**Goals:**

- The tracking job and the manual refresh share one path that stores tracking, stage dates, and the shipped letter.

**Non-Goals:**

- No new UPS call. Tracking stays a read of the latest status, without storing UPS event history.
- No PDF built on the server. Printing stays in the browser.

## Decisions

### Batch purchase loops the existing endpoint in the panel

The queue calls `POST /api/v1/admin/billing/subscriptions/:id/shipments` once per selected order, one at a time. That route already enforces paid invoice, scope, one active label, reuse, and the unknown-outcome rules, and answers per order. A server batch route was considered and rejected: 20 UPS purchases in one request could pass the proxy timeout, and a partial result would need its own format. If the tab closes mid-batch, the rest is not bought, and running the batch again is safe because each invoice reuses its label.

### Queue read is one new route

`GET /api/v1/admin/shipments/queue` with `shipping.read` returns two lists: `ready` (with `issues`, empty when selectable) and `created`. Candidates are US ledger rows with `paid_invoice_id`, joined to `ups_shipments` rows that are not voided. Issues come from `inspectLabel`, so the queue and the subscription detail cannot disagree. The read is capped at 100 orders and reports `truncated`. Market scope uses the existing admin market rules, so a Brazil-scoped actor gets empty lists.

The queue does not filter by production status. The operator chooses which ready orders to buy.

### Stage dates are two new columns

Migration `1700000000062` adds `in_transit_at` and `out_for_delivery_at`, both nullable `DATETIME`. Label created reads `shipped_at`, and delivered reads `delivered_at`. `recordTracking` writes each date with `COALESCE`, so the first date stays. The date is the read time, or the UPS delivery time for delivered. A read at a later stage leaves earlier dates null, and the timeline treats any stage before the current one as reached. An exception read sets `tracking_status` to `exception` and writes no stage date, so the warning lasts until the next read. The current stage comes from the highest stage reached, not from the last status.

Alternative: one JSON column of stage dates. Rejected, because the queue and reports already read plain columns.

### Shipped letter moves into the tracking path

`UpsShipmentService` gets a `recordTracking(row, payload)` method used by the job and by `refreshTracking`. After storing, when the shipment has reached in transit or later and is not voided, it calls `notifyShippedMail`. The claim on `shipped` + shipment id keeps it to one letter, which also covers labels whose letter was sent at purchase before this change. `createForSubscription` stops calling it. The job loads the subscription for the mail the same way `refreshTracking` does. A mail error is logged and does not fail the tick.

### Store gets stage dates from the plan detail

`subscriptions-detail.repository.js` already adds `tracking_status` and `delivered_at` to each charge. It adds `label_created_at`, `in_transit_at`, `out_for_delivery_at`, and `tracking_description`. The store builds the four stages in `PlanDetail.tsx`. No new store route.

### Printing several labels

`printLabel.ts` gets `printLabels(blobs)`, which builds one document with one 4x6 page per label (`page-break-after`) and reuses the rotation rule for each image. `printLabel` becomes a call with one blob.

## Risks / Trade-offs

- [UPS sandbox always answers delivered] → Stage order and the letter are covered by unit tests with read shapes for each stage. In sandbox only the delivered path runs.
- [A box never scanned in transit gets no letter until a later read] → The letter goes out on the first read of any moving stage, including delivered.
- [Customers who used the letter as a sign the order left lose it at purchase] → Intended. The letter arrives at pickup.
- [A long batch runs while the operator waits] → The panel shows progress per order and can be run again safely.
- [Tracking poll covers 20 shipments per 30 minutes] → Unchanged here. A larger queue can delay the letter, and the manual refresh sends it at once.

## Migration Plan

1. Deploy the backend with migration 062. Existing rows keep their dates. `in_transit_at` and `out_for_delivery_at` stay null for past shipments, which the timeline reads as reached with no date when a later stage is set.
2. Deploy the admin panel and the store.
3. Rollback: revert the code. The two columns can stay, since nothing else reads them.
