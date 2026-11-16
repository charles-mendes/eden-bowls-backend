# Design

## Context

See proposal.md, "Why". Relevant current state:

- `DeliveryAddressIssuesRepository.close(id, { resolvedBy, now })` closes one problem by clearing `open_key`. `resolved_by` is `VARCHAR(16)`.
- The subscription status lives on the ledger (`stripe_subscriptions.status`) and is written by `StripeWebhookService.handleSubscriptionChanged` for `customer.subscription.updated` and `customer.subscription.deleted`.
- Paid cycles are in `subscription_production_cycles` (`paid_at`, `paid_invoice_id`). `listMarketExceptions` already defines "box has not left" in SQL: no `courier_deliveries` row in `out_for_delivery`/`delivered` and no `ups_shipments` row in `created`/`delivered` for the invoice, compared with `COLLATE utf8mb4_unicode_ci` because those tables use another collation.
- `addressIssueService` is already injected into the webhook, courier and UPS services (`src/index.js`).

## Goals / Non-Goals

**Goals:** one rule, written once in SQL, used for a single subscription (events) and for every subscription (deploy).

**Non-Goals:** no date floor on the paid cycles; no job or periodic sweep; no change to Today's counts or the queues.

## Decisions

### One repository query for the rule

`closeEnded({ subscriptionId = null, now })` runs one `UPDATE delivery_address_issues i JOIN stripe_subscriptions s ON s.id = i.subscription_id SET open_key = NULL, resolved_at = ?, resolved_by = 'ended' WHERE i.open_key IS NOT NULL AND s.status = 'canceled' AND NOT EXISTS (<paid cycle of s whose box has not left>)`. With `subscriptionId`, it adds `AND i.subscription_id = ?`. It returns the affected row count. The subquery reads `subscription_production_cycles c WHERE c.subscription_id = s.id AND c.paid_at IS NOT NULL AND c.paid_invoice_id IS NOT NULL` plus the "not left" conditions of `listMarketExceptions` (no courier `out_for_delivery`/`delivered` and no UPS `created`/`delivered` for `c.paid_invoice_id`), with no delivery date floor. Without the paid predicate, a cycle not paid yet would count as not left and keep the problem open.

The status is only `canceled`: `mapStripeStatus` stores Stripe's `canceled` and `incomplete_expired` both as `canceled`, so the ledger never holds `incomplete_expired`. `marketExceptionWhere` lists both, which is harmless but not copied here.

The issues repository receives the ledger, cycles, courier and UPS table names as options, with the same defaults as the ledger repository.

Alternative: read the subscription and its cycles in JS and call `close`. Rejected because it needs two code paths (one subscription, all of them) that can drift, and a read-then-write race against a new event.

### No date floor

A canceled subscription with an old paid cycle that never left keeps its problem. That box is owed. A floor (like the queue's 30 days) would close a problem the operator may still need. QA data with old unshipped cycles stays open. It can be closed by hand.

### Service method and call sites

`DeliveryAddressIssueService.closeIfEnded(subscriptionId)` calls the repository and logs its own errors without throwing, like `report`. Calls:

- `StripeWebhookService.handleSubscriptionChanged`, after `ledgerRepository.upsert`, with the ledger id (read back via `findByStripeSubscriptionId`).
- `CourierDeliveryService.dispatch`, after the insert and the audit.
- `UpsShipmentService`, after `markCreated` succeeds.

Delivered and failed courier updates need no call. "Delivered" follows "out for delivery", which already counts as left. "Failed" makes the box "not left" again, and closing only ever runs forward.

Alternative: check only on cancellation. Rejected because a cancellation with a paid box still to leave would never close afterwards.

### Deploy: a migration with the same SQL

Migration `1700000000072-close-address-issues-of-ended-subscriptions` runs the same `UPDATE` with no subscription filter. Migrations here already update data (`1700000000071`), and a migration runs once, with the deploy. The SQL is copied into the migration on purpose: a migration is a snapshot and must not change when the repository does. `down` is a no-op, because the closed problems cannot be told apart from later ones without guessing.

## Risks / Trade-offs

- [A cycle reopens, for example after a refund or a failed delivery, after the problem closed as `ended`] → The next event (`courier_failed` with `address_unusable`, `courier_check`) opens a new problem, as for any closed one.
- [The webhook arrives before the ledger status is saved] → The call runs after the `upsert` in the same handler.
- [A label voided after `markCreated`, or a courier delivery that fails after the problem closed] → Not reopened. The next address event opens a new problem.
- [Collation mismatch between tables] → The subquery uses the same `COLLATE` comparisons as `listMarketExceptions`, and a MySQL integration test covers it.

## Migration Plan

Deploy the backend with the migration. The panel can deploy before or after it: it already shows the unknown `resolved_by` as "Substituído". Rollback: revert the code. Problems already closed stay closed.
