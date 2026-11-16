# Design

## Context

- UPS lives in `ups_shipments`, `UpsShipmentService` (`src/services/ups-shipment.service.js`) and the label queue (`listPaidLabelCycles` in `subscription-ledger.repository.js`, filtered to `stripe_account = 'us'`). Nothing like that exists for Brazil.
- The panel hides UPS for Brazil in `SubscriptionDetailPage.tsx` with `shipsWithUps = data?.term?.marketCountry === 'US'`. The comment says the delivery address decides, not the Stripe account. This design keeps that rule.
- Paid cycles come from the production cycles table (`paid_invoice_id`, `delivery_date`, `status`) joined to the ledger in `queueSourceSql()`.
- `isChargedDeliveryInvoice` (`src/core/contract-deliveries.js`) already tells a charged delivery from a $0 skipped cycle, and the UPS purchase uses it now.
- The store reads `delivery_timeline` from `billing_history` in the customer subscription detail (`subscriptions-detail.repository.js`). The UPS timeline is built in `src/core/delivery-timeline.js`.
- Letters go through `transactional-mailer.js` with `sendClaimed` (one claim per subscription, template and reference).

## Goals / Non-Goals

**Goals:**
- One record per delivery attempt, so failures stay in the history.
- The same eligibility and market rules as UPS, with BR in place of US.
- A store timeline payload in the same shape the store already renders, so the store only adds new stage keys.

**Non-Goals:**
- Calling Uber Direct or any courier API, getting quotes, or receiving webhooks.
- Proof-of-delivery photos or signatures.
- Cost reports or reconciliation. The cost is stored only for later use.
- Batch dispatch of several orders in one action. Rows are dispatched one at a time.

## Decisions

### Own table `courier_deliveries`, not rows in `ups_shipments`
Columns: `id`, `subscription_id` (ledger id), `user_id`, `stripe_account`, `stripe_invoice_id`, `method` (`uber|motoboy|own_driver|other`), `courier_name`, `tracking_url`, `cost_minor`, `currency` (`brl`), `note`, `status` (`out_for_delivery|delivered|failed|canceled`), `out_for_delivery_at`, `delivered_at`, `failed_at`, `failure_reason`, `canceled_at`, `created_by`, `updated_by`, `created_at`, `updated_at`.
Alternative: reuse `ups_shipments` with a carrier column. Rejected because its columns (label image, UPS id, tracking scans, void) do not apply, and the UPS code paths would have to skip courier rows everywhere.

### One active row per invoice through a unique generated column
The migration follows `1700000000030-add-ups-shipments-active-invoice-unique.js`. It creates the table, then adds the generated column and the unique index with raw SQL (`ALTER TABLE ... ADD COLUMN ... GENERATED ALWAYS AS (...) STORED` and `CREATE UNIQUE INDEX`), checking `information_schema` first. It does not use TypeORM schema helpers for the generated column, because `getTable()` would then look for `typeorm_metadata`.
`active_invoice_key` is a stored generated column: `stripe_invoice_id` when `status IN ('out_for_delivery','delivered')`, else `NULL`. It has a unique index. MySQL allows many `NULL`s, so failed and canceled rows stay while a new attempt is inserted. A duplicate-key error on insert becomes 409 `courier_delivery_active`. This handles two dispatches at the same time without a lock.
Alternative: check-then-insert in the service. Rejected because it races.

### Eligibility by delivery address, checked like a UPS purchase
`CourierDeliveryService.dispatch` loads the subscription via `adminBillingService.getSubscription`, requires `address.country === 'BR'`, reads the invoice with `getSubscriptionInvoice`, and reuses the ownership check (`extractSubscriptionIdFromInvoice`), `status === 'paid'` and `isChargedDeliveryInvoice`. The error codes match the UPS ones (`invoice_not_paid`, `invoice_not_in_subscription`, `invoice_not_delivery`) so the panel can reuse its messages.

### Status changes are conditional updates
`markDelivered`, `markFailed` and `cancel` run `UPDATE courier_deliveries SET status = ?, ... WHERE id = ? AND status = 'out_for_delivery'`. When zero rows are affected, the service reloads the row and answers 409 `courier_delivery_final`, or 404 if the row is gone. `updateDetails` uses `WHERE id = ? AND status <> 'canceled'` the same way. Two completions racing therefore give one success and one 409, and only the winner sends the delivered letter. The claim in `sendClaimed` is a second guard.

### Field validation
The tracking link is parsed with `new URL()` after trimming. It must have `protocol === 'https:'`, a non-empty `hostname`, empty `username` and `password`, no whitespace in the raw string, and a length of at most 500. The value stored is the trimmed input. The cost is parsed as a decimal string with `/^\d+(\.\d{1,2})?$/` and converted to integer centavos without floating point. The courier name is capped at 120 characters and the note at 500. The delivered instant must satisfy `out_for_delivery_at <= delivered_at <= now`.

### Readiness confirmation by flag
The dispatch body carries `confirm_not_ready: true`. Without it, when the production status is not `ready` or the subscription is not `active`/`trialing`, the API answers 409 `courier_dispatch_needs_confirmation` with `reasons: [...]`. The panel asks again and resends. This mirrors the batch confirmation in `ups-label-queue`.

### Routes
All under `/api/v1/admin`, permission `shipping.read` for reads and `shipping.write` for writes:
- `GET /courier-deliveries/queue` (market `query`): the four groups.
- `GET /billing/subscriptions/:id/courier-deliveries` (market `record`).
- `POST /billing/subscriptions/:id/courier-deliveries` (market `record`): dispatch. Body: `invoice_id`, `method`, `courier_name?`, `tracking_url?`, `cost?` (decimal BRL), `note?`, `confirm_not_ready?`.
- `PATCH /courier-deliveries/:id` (market `record`): edit details.
- `POST /courier-deliveries/:id/delivered` (`delivered_at?`), `/failed` (`reason`), `/cancel`.

The market of a record is the market of its subscription, so record scope answers 404 across markets. The `query` scope on the queue keeps it empty for US-only staff.

### Queue query: the floor applies to "to dispatch" only
- **To dispatch:** a new `listPaidCourierCycles` in the ledger repository. It uses `queueSourceSql()` with `payment_state = 'paid'`, `paid_invoice_id IS NOT NULL`, the address country BR (`JSON_UNQUOTE(JSON_EXTRACT(q.address, '$.country')) = 'BR'`), and a delivery date (`COALESCE(delivery_date, DATE(cycle_period_end))`) on or after the floor. The floor is today minus 30 civil days in `America/Sao_Paulo`, computed with the timezone helper the production queue already uses (`civilDaysUntil`). Invoices that have any active or failed courier row are then dropped.
- **Out for delivery** and **failed:** read from `courier_deliveries` by status with no date floor. Failed keeps only the newest failed row per invoice, and only when the invoice has no active row. The ledger and address are joined for display.
- **Delivered:** `courier_deliveries` with `delivered_at` at or after the start of the civil day 6 days ago in São Paulo (today plus the 6 days before it).
- The service merges the groups, so an invoice lands in one group only.
- **$0 cycles:** `recordPaid` (`stripe-webhook.service.js`) runs only for `isChargedDeliveryInvoice` invoices, so a skipped cycle never becomes a paid production cycle. The queue therefore matches the spec. Dispatch still re-checks the invoice as a second line of defense.

### Recipient on queue and detail
`addressRecipient`-style read: `address.recipient_name`, then the production queue presenter's chain (`name`, `full_name`, `recipient`, customer email). It reuses the reader that change `delivery-recipient-name` adds to `production-queue-presenter.js`, so both screens show the same name. That change ships first.

### Store timeline shape
`src/core/courier-timeline.js` returns the same object as `deliveryTimeline`: `{ carrier: 'courier', current, stages: [{ key, reached, at }], description, warning }`. The stage keys are `preparing`, `out_for_delivery` and `delivered`. `preparing.at` is the invoice paid date. A failure with no active row gives `warning: { status: 'failed' }`. The customer detail attaches it to the `billing_history` row of the invoice, sets `tracking_url` from the active row, and leaves `tracking_number` `null`. Today `PlanDetail.tsx` renders the link only inside `entry.trackingCode &&`, so the store gets a separate branch: when there is no tracking code and there is a `trackingUrl`, it shows a "Acompanhar entrega" / "Track delivery" link. The UPS branch is unchanged. The `failed` warning gets its own text, because an unknown warning status falls into the UPS exception copy today. The store picks stage labels by key, so it only adds `preparing` and the courier copy. `carrier` is also added to UPS timelines (`'ups'`) so the store can tell them apart.

### Letters
There are two templates, `courier_out_for_delivery` and `courier_delivered`, in `transactional-emails.js`. Following `transactional-email-layout`, their copy comes from new designer files in `new-designer-emails/pt` and `/en`, derived from `shipped.html`. Each claim uses the courier row id as reference. The service sends after the conditional write succeeds and catches failures (logged, never thrown). They are pt-BR by the existing locale rule. The greeting uses `firstNameFrom`, like the other letters. A failed send is not retried: unlike `sendShippedLetterIfDue`, there is no tracking tick to hook into, and `transactional-emails` forbids a mail job. A manual resend action is out of scope.

### Panel
- A new page "Entregas Brasil", in the menu next to the UPS queue and visible with `shipping.read`. It has four tabs (A despachar, Em rota, Falhas, Entregues 7 dias). The dispatch modal holds method, courier, link, cost and note. Row actions are delivered, failed (with reason) and cancel.
- `SubscriptionDetailPage`: when `shipsWithUps` is false, it shows the courier section with the same list and actions.

## Risks / Trade-offs

- [The operator forgets to mark delivered] → The out-for-delivery tab shows how long each delivery has been on the road. A reminder or automatic close is left out on purpose.
- [The address country is missing on old ledgers] → The country is read the same way as `term.marketCountry`. A subscription with no country is not listed, and dispatch refuses it with `courier_country_not_supported`. Checkout picks the Stripe account from the address country, and the subscription edit forces the address country to the ledger market (`withLedgerMarket`), so the two agree in practice.
- [A letter lost to an SMTP failure] → It is logged with the template and the delivery id. The operator can tell the customer directly. An explicit resend is a possible follow-up.
- [A customer gets two out-for-delivery letters after a retry] → This is intended: each attempt is a real departure.
- [Generated columns in older MySQL] → MySQL 5.7+ supports stored generated columns with unique indexes. Local and QA run 8.x.

## Migration Plan

1. The migration creates `courier_deliveries` with its indexes: `active_invoice_key` unique, `(subscription_id)`, and `(status, out_for_delivery_at)`.
2. Deploy the API, then run `npm run routes:manifest` and commit the JSON. In the panel, run `npm run contract:sync`, then deploy the panel and the store.
3. Rollback: revert the panel and store first, then the API. The table can stay.

## Open Questions

- The final copy of the two letters. The layout is fixed, and the text can be adjusted at implementation without changing the specs.
