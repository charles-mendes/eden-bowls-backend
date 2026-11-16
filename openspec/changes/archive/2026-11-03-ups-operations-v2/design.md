# Design

## Context

- `ups_shipments` keeps `shipped_at` (set when the label is bought), `tracking_status`, `tracking_description`, `delivered_at`, and `tracking_checked_at` (migration 059). The table has a generated column, so migrations use raw SQL with an `information_schema` check instead of `getTable()`.
- `parseUpsTracking` reads only `activity[0]`. Delivered comes from type `D` or a `DEL` delivery date. Out for delivery comes only from the English text "out for delivery". `RS` maps to `unknown`.
- `recordTracking` is called by `runUpsTracking` and by `UpsShipmentService.refreshTracking`. Neither sends mail, and `refreshTracking` loads no subscription.
- `createForSubscription` buys one label per invoice. A UPS 4xx deletes the pending row. A timeout, network error, or 5xx marks it `unknown` and answers `502 ups_shipment_unknown`. A pending or unknown row without a UPS id answers `409 ups_shipment_unresolved` to later attempts. It then calls `notifyShippedMail`.
- `voidShipment` closes a pending or unknown row locally only with `confirmNotCreated`. The admin panel never sends that flag, and voids a created label with one click.
- `sendClaimed` deletes the claim when SMTP fails (`releaseUnsent`). The `mail_resend` job only resends claims that still exist, so it never sees that failure. The main `background-jobs` spec says the claim stays. That conflict is older than this change and is not fixed here.
- `notifyShipped` needs `subscription.user.email`. The order letter uses the ledger `customerEmail`, with the invoice email as fallback.
- Paid production cycles come from `queueSourceSql` in `subscription-ledger.repository.js`. A paid cycle stays there with no date bound and no final status.
- The active change `ups-environment-guard` adds `ups-shipments`, not yet a main spec, and its task 5.3 (show unknown rows and offer the confirmed close in the panel) is covered here. This change uses new capabilities, so the two can be archived in either order.

## Goals / Non-Goals

**Goals:**

- The tracking job and the manual refresh share one path for tracking, stages, and the shipped letter.

**Non-Goals:**

- No new UPS call and no UPS event history table.
- No PDF built on the server. Printing stays in the browser.
- No change to `sendClaimed` or `mail_resend`.
- One label per invoice stays the model. Shipments with several boxes are out of scope.

## Decisions

### Batch purchase loops the existing endpoint in the panel

The queue calls `POST /api/v1/admin/billing/subscriptions/:id/shipments` once per selected order, one at a time. That route already enforces paid invoice, scope, one active label per invoice (unique key), reuse, and the unknown outcome. A server batch route was rejected: 20 UPS purchases in one request could pass the proxy timeout. If the tab closes mid-batch, the rest is not bought, and running it again is safe.

Results map as: `reused: false` is created, `reused: true` is already had a label, `502 ups_shipment_unknown` and `409 ups_shipment_unresolved` are in progress with `shipment_id`, any other error is failed with its code. The confirm button stays disabled until the loop ends.

### Queue read is one new route

`GET /api/v1/admin/shipments/queue` with `shipping.read` returns `ready` (each with `issues`, empty when selectable), `unresolved`, and `created`. Candidates are paid cycles from `queueSourceSql` with `stripe_account = 'us'` and a delivery date no older than 30 days, joined to the active `ups_shipments` row of `paid_invoice_id`. The 30 days match `OVERDUE_DAYS` in the admin today view, so cycles from before UPS labels do not flood the list. Each row carries customer name, city, ZIP, production status, subscription status, and delivery date. Issues come from `inspectLabel`. The read is capped at 100 orders with `truncated`. A Brazil-scoped actor gets empty lists.

The queue shows paused or canceled subscriptions with a paid cycle, because that food is paid for. The extra confirmation covers them, together with any production status other than `ready`.

### Military addresses are blocked

`inspectLabel` adds `military_address_not_supported` when the city is APO, FPO, or DPO, because UPS does not deliver to them. The single purchase and the queue get it from the same check. The panel adds the text to `labelIssueText`.

### Parser reads every activity

`parseUpsTracking` maps each activity to a stage: `D` to delivered, code `OF` or status `072` to out for delivery (plus the English text as a fallback), `P` and `I` to in transit, `X` and `RS` to a warning, `M` to label created. It returns the current status, the latest description, and the earliest scan date per stage. `SDD` delivery dates are ignored. The out-for-delivery codes are one list, so a code confirmed later is a one-line change.

### Stage dates are new columns

Migration `1700000000062` adds `in_transit_at`, `out_for_delivery_at`, and `shipped_letter_sent_at`, all nullable `DATETIME`, in the same raw-SQL form as 059, with a `down` that drops them. No index, because the job does not filter on stage dates. `up` sets `shipped_letter_sent_at = shipped_at` on created and delivered rows, since their letter went out at purchase.

`recordTracking` writes each stage date with `COALESCE`, so the first date stays. Stage dates are the UPS scan time as UPS sends it, without a time zone, like `delivered_at` today. Label created stays `shipped_at`. A warning read sets `tracking_status` to `exception` or `returned` and writes no stage date. The current stage is the highest stage with a date or below a later reached stage, and the latest description is always returned.

### Shipped letter moves into the tracking path

`UpsShipmentService.recordTracking(row, payload)` stores the read, then sends the letter when the row has reached in transit or later, is not voided, and has no `shipped_letter_sent_at`. It loads the ledger row by subscription and passes the ledger `customerEmail` as the recipient. On a sent or already-sent claim it sets `shipped_letter_sent_at`. On a failure the column stays null, so the next read tries again. The `shipped` claim on the shipment id keeps a refresh and a tick at the same time to one letter. `createForSubscription` stops calling the mailer.

The job also selects delivered rows with `shipped_letter_sent_at` null and `delivered_at` within 7 days, and tries only the letter for them, without a UPS call. The tick logs `scanned`, `updated`, `failed`, and `mailed`.

### Store gets stages from the plan detail

`subscriptions-detail.repository.js` already adds `tracking_status` and `delivered_at` per charge. It adds `label_created_at`, `in_transit_at`, `out_for_delivery_at`, `tracking_description`, and `delivery_timeline`, built by `deliveryTimeline` in `src/core/delivery-timeline.js`, so the stage rules live in one place. `PlanDetail.tsx` only renders it. No new store route.

### Printing several labels

`printLabel.ts` gets `printLabels(blobs)`, one document with one 4x6 page per label (`page-break-after`), reusing the rotation rule per image. `printLabel` calls it with one blob. A label whose download answers 404 is reported as missing and left out.

### Void in the detail asks first

The subscription detail asks for confirmation before voiding a created label. For a pending or unknown row it shows the row and a close action that states the operator checked UPS and found no label, and sends `confirm_not_created: true`.

## Risks / Trade-offs

- [UPS sandbox always answers delivered] → Stage mapping, warnings, and the letter are covered by unit tests with recorded payloads, including `OF`/`072` with `SDD`, `RS`, and a delivered read with earlier scans. CIE proves purchase without a letter, printing, and the letter on the delivered read.
- [Other out-for-delivery codes on the account] → One list to extend; see Open Questions.
- [Activity order in the UPS response] → The parser takes the earliest scan per stage by its date and time, not by position.
- [Tracking poll covers 20 shipments per 30 minutes] → Fine at today's volume. At 50 to 100 orders a day the letter could wait hours; the batch size is the knob then.
- [CIE answers every purchase with the same shipment id, `1ZXXXXXXXXXXXXXXXX`] → The purchase recovers a row by UPS shipment id, so in CIE a second invoice reuses the first label and the queue would print that label for the wrong order. Production ids are unique. A local test needs the earlier row's id changed first.
- [Refresh needs only `shipping.read` and can now send the letter] → Same effect as the job, accepted.

## Migration Plan

1. Deploy the backend with migration 062. Existing letters count as sent. Past shipments keep null transit dates, which the timeline reads as reached with no date when a later stage is set.
2. Deploy the admin panel and the store.
3. Rollback: revert the code and run the 062 `down`. Letters for shipments picked up during the rollback window could repeat once if the code is redeployed, which is accepted.

## Open Questions

- Which out-for-delivery status codes, besides `OF` and `072`, does the UPS catalog for this account use? Adding one only extends the list.
