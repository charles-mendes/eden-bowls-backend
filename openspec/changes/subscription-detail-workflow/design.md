# Design

## Context

- `SubscriptionDetailPage.tsx` (eden-bowls-admin, ~960 lines) loads the detail, paid cycles, courier deliveries, UPS shipments, Eden Bowls invoices, NF-e list and contacts through separate requests, each gated by its own permission. Stripe invoices load only on `POST …/sync-invoices`, whose `amountPaid` is Stripe's `amount_paid` in minor units (the current table prints it raw). Messages and errors are page-level state rendered at the top.
- `handleInvoicePaid` (`stripe-webhook.service.js`) checks the `eden_env` marker, then resolves the user context and reads the stored ledger row. Then it may call `startNewContract` (pending term change), upserts the ledger (keeping `existing.stripeAccount`), and updates the checkout reference. After that it records the NF-e, issues the invoice with `runtime.account`, sends letters, and records the production cycle and the charged delivery. `customer_invoices` is unique on `(stripe_account, stripe_invoice_id)`, so two endpoints make two rows. `warnIgnored` logs only `type`, `eventId`, `stripe_account` and `reason`.
- Paid cycles (`GET …/paid-cycles`) come newest delivery first. Production status is `to_prepare`, `in_production`, `ready` or `blocked`. A cycle's `ups_shipment` carries only status and tracking number. The tracking status (`label_created`, `in_transit`, `out_for_delivery`, `delivered`, `exception`, `returned`) is on the shipments list the page loads. UPS shipment status is `created`, `pending`, `unknown`, `voided` or `delivered`.
- The detail returns `account_name` only when the profile is in the actor's markets. There is no `customerName`. `address_issue` is the open problem or the last one resolved in 30 days, with `open`.
- The NF-e detail already returns `missing_fields` and `bling_problems`. The panel has `missingFieldLabel` and `blingProblemGuide` in `src/lib/nfe.ts`. The subscription list returns only `presentSummary`. A blocked note is fixed by the customer in the store, and "Corrigir dados" on the note page is for exceptions.
- `#faturas-stripe` is linked from `CustomerSubscriptionCard`, `NfeDetailPage` and their tests.

## Goals / Non-Goals

**Goals:**
- One `invoice.paid` makes at most one set of writes: ledger, NF-e, invoice, letters and cycle.
- The page answers "how is this order" and "what do I do next" before showing any table.
- Build the new view from data the page already loads. No new route.

**Non-Goals:**
- Guarding other webhook events (`invoice.created`, `customer.subscription.*`, payment failures) by account. They are idempotent upserts or emails with their own dedupe.
- Deleting the local duplicate invoice rows. The charges row shows both instead.
- Redesigning the product, address and freight snapshot sections beyond the repeated total.
- Changing the UPS or courier actions themselves. They only move into the card and the narrow-screen layout.

## Decisions

1. **Account guard before the first write.** In `handleInvoicePaid`, after the marker check and `resolveUserContext`, read `existing` (`context.ledger` or `findByStripeSubscriptionId`) once. If `existing?.stripeAccount` is set and differs from `runtime.account`, log and return before `startNewContract`. The later code reuses the same `existing`. `warnIgnored` gains optional `stored_account`, `subscription_id` and `invoice_id` from `extra`, and existing callers are unchanged. The response is 200 and the event is recorded as processed, like the marker guard, so Stripe does not retry.
   - *Alternative:* guard only the invoice issuance. Rejected because the NF-e, letters, cycle and contract would still run twice, with the wrong account.
   - *Alternative:* widen the unique key to `stripe_invoice_id` alone. Rejected because it hides the wrong account instead of refusing it, and needs a migration.

2. **NF-e list items reuse the detail's presenters.** `listForSubscription` adds `stripe_invoice_id`, `missing_fields` and `bling_problems` with the helpers the detail uses (`blingProblems(row)`). The payloads (`request_payload` and `response_payload`) stay out of the list.

3. **The charges view is a pure join in the panel.** A `buildCharges({ subscriptionAccount, paidCycles, customerInvoices, nfeItems, stripeInvoices })` helper in `src/lib/charges.ts` keys rows by Stripe invoice id, newest first, and is tested without React.
   - Amount: the Eden Bowls invoice `total_minor`, else Stripe `amountPaid / 100` with its currency, else "—". The fetched Stripe rows get the same conversion, which fixes the raw cents shown today.
   - Two Eden Bowls invoices on one key: the one whose `stripe_account` matches the subscription is primary, and the other goes into `otherInvoices`.
   - A source the reader cannot load adds nothing. "Buscar na Stripe" calls the existing sync route and merges. "PDF Stripe" keeps the existing `openPdf` with the account parameter.
   - The section keeps `id="faturas-stripe"`.
   - *Alternative:* a new backend route returning the joined charges. Rejected for now because every piece is already loaded and a new route would mean manifest and contract churn.

4. **The attention block is derived on the page** from `nfeItems`, `address_issue` (only `open: true`), `courier_issues`, failed `courierItems` and `market_exception`. Text and links reuse `missingFieldLabel`, `blingProblemGuide`, `issueCodeText` and `alertPresentation` where the code matches, so the wording matches the customer page and the NF-e detail. NF-e entries link to `/operations/nfe/:id`.
   - The "Problema de endereço" section stays, because it holds the contact action, and gets an `id` the entry links to.
   - The standalone market-exception warning is removed. It becomes an entry linking to market exceptions.
   - *Alternative:* call the customer-subscriptions alerts API. Rejected because it is per user, not per subscription, and would add a request.

5. **Current cycle selection and stage live in `src/lib/currentCycle.ts`.**
   - Selection: the last element of `paidCycles` (newest first) that is not delivered, else `paidCycles[0]`.
   - Delivered means: the courier delivery is `delivered`, or the active UPS shipment from the page's shipments list (same `stripe_invoice_id`, not `voided`) has status `delivered` or tracking `delivered`.
   - The stage follows the table in the spec: shipment first, then production. The function returns `{ cycle, stage, tone, action }`, where `action` is an identifier the card maps to the existing handlers (`setDispatchInvoice`, `createShipment`, `refreshTracking`, `closeUnresolvedShipment`, `printShipmentLabel`, courier row actions). It is filtered by `shipping.write`.

6. **Header.** The four metric cards are replaced by the title (`account_name || user.email`), a line with the email when the title is a name, the status badge (`formatStripeStatus`), "renova em <day>" or "termina em <day>" when `cancelAtPeriodEnd`, and the existing note on pause and cancel. The current cycle card follows.

7. **Feedback is scoped per section.** A small `useSectionFeedback()` hook holds state, an auto-clear timer for success, and a dismiss button for errors. Each section renders its own feedback, and the top keeps only load failures.

8. **Confirmation uses the existing `Dialog` component**, not `window.confirm`, because it can show the invoice number and the email clearly and can be tested. Existing `window.confirm` calls on the UPS and courier flows stay as they are.

9. **Narrow screens use CSS, not a second component.** At 640px and below, the charges, delivery and UPS rows render as stacked cards (`display: block` rows with `data-label` captions) inside a page-scoped class. Global `table` CSS breaks other components, so these styles stay scoped to the page wrapper.

10. **Plan description and freight.**
    - Plan: the panel uses `planLabel` unless it matches `/^Plan #\d+$/`. Otherwise it builds the text from the checkout copy (`term.months`, pets, total packs) through `parseCheckoutSnapshots`. `planLabelFromLedger` in the API does not change, because other screens use it.
    - Freight: the charged freight is the subscription's single `shipping.cost` (`customerShippingFrom(data.shipping)`), shown next to each courier cost.
    - Totals: when the plan subtotal equals the first invoice, `LedgerSnapshotSections` shows only "Subtotal do plano".

11. **The page is split into components:** `SubscriptionHeader`, `CurrentCycleCard`, `AttentionList`, `ChargesSection`, plus the existing courier and UPS sections moved into their own files. This keeps each part testable on its own.

## Risks / Trade-offs

- [A subscription stored with the wrong account loses its legitimate `invoice.paid`, and Stripe does not resend it] → Checkout writes the account from the address and nothing rewrites it on `invoice.paid`. The warning names the subscription, the invoice and both accounts, so it can be found and replayed after the stored account is fixed. In production each endpoint has its own signing secret, so the guard mainly covers the shared local sandbox and this wrong-account case.
- [The charges join misses an invoice the operator expects] → "Buscar na Stripe" stays available, and rows from any source appear even when another source is empty.
- [The current cycle hides a newer paid cycle] → The card says how many more paid cycles are waiting, and the charges and delivery sections still list all of them.
- [The per-section feedback refactor touches many handlers] → Move one section at a time, keep the existing tests green, and add one test per section for where its message appears.
- [Card layout on narrow screens hides columns' meaning] → Each cell carries its column name as a caption. Verify with Playwright screenshots at 390px and 1440px.

## Migration Plan

No schema change. Deploy the backend guard and the NF-e list fields first. The panel tolerates missing `missing_fields`, `bling_problems` and `stripe_invoice_id` from an older API: an NF-e without `stripe_invoice_id` gets its own row, and its entry falls back to status and last error. Rollback is a plain revert of either side.
