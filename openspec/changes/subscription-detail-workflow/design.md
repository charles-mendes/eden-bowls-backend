# Design

## Context

- `SubscriptionDetailPage.tsx` (eden-bowls-admin, ~960 lines) loads the detail, paid cycles, courier deliveries, UPS shipments, Eden Bowls invoices, NF-e list and contacts through separate requests, each gated by its own permission. Stripe invoices load only on `POST …/sync-invoices`. Messages and errors are page-level state rendered at the top.
- `handleInvoicePaid` (`stripe-webhook.service.js`) already reads the stored ledger row (`context.ledger` or `findByStripeSubscriptionId`) and keeps `existing.stripeAccount` on upsert. Then it records the NF-e and issues the invoice with `runtime.account`, the endpoint's account. `customer_invoices` is unique on `(stripe_account, stripe_invoice_id)`, so two endpoints make two rows.
- The NF-e detail already returns `missing_fields` and `bling_problems`. The panel already has `missingFieldLabel` and `blingProblemGuide` in `src/lib/nfe.ts`. The subscription list returns only `presentSummary`.
- The customer page already turns API alerts into text through `alertPresentation` (`src/lib/customerSubscriptions.ts`).

## Goals / Non-Goals

**Goals:**
- One `invoice.paid` makes at most one Eden Bowls invoice, NF-e row and letter.
- The page answers "how is this order" and "what do I do next" before showing any table.
- Build the new view from data the page already loads. No new route.

**Non-Goals:**
- Guarding other webhook events (`invoice.created`, `customer.subscription.*`, payment failures) by account. They are idempotent upserts or emails with their own dedupe. This can be revisited if a duplicate shows up.
- Deleting the local duplicate invoice rows.
- Redesigning the product, address and freight snapshot sections beyond the repeated total.
- Changing the UPS flow. Its table only moves into the narrow-screen card layout.

## Decisions

1. **Account guard at the top of `handleInvoicePaid`, after the user context resolves and before any write.** If `existing?.stripeAccount` is set and differs from `runtime.account`, call `warnIgnored(event, 'account_mismatch', …)` and return. This follows the existing `eden_env` marker guard (200, no writes, a warning), so Stripe does not retry.
   - *Alternative:* guard only the invoice issuance. Rejected because the NF-e row and the letter would still run twice, and the NF-e would carry the wrong account.
   - *Alternative:* widen the unique key to `stripe_invoice_id` alone. Rejected because it hides the wrong account instead of refusing it, and needs a migration.

2. **NF-e list items reuse the detail's presenters.** `listForSubscription` adds `stripe_invoice_id`, `missing_fields` and `bling_problems` with the same helpers the detail uses (`blingProblems(row)`). The payloads (`request_payload` and `response_payload`) stay out of the list.

3. **The charges view is a pure join in the panel.** A `buildCharges({ paidCycles, customerInvoices, nfeItems, stripeInvoices })` helper in `src/lib/charges.ts` keys rows by Stripe invoice id. It orders them by cycle or issue date, newest first, and tests them without React. A source the reader cannot load (missing permission) simply adds no rows or columns. "Buscar na Stripe" calls the existing sync route and merges the results.
   - *Alternative:* a new backend route returning the joined charges. Rejected for now because every piece is already loaded and a new route would mean manifest and contract churn. It is worth reconsidering if the join grows.

4. **The attention block is derived on the page** from `nfeItems`, `address_issue`, `courier_issues`, `courierItems` (failed) and `market_exception`. Text and links come from `missingFieldLabel`, `blingProblemGuide`, `issueCodeText` and `alertPresentation` where the alert code matches, so the wording matches the customer page and the NF-e detail.
   - *Alternative:* call the customer-subscriptions alerts API. Rejected because it is per user, not per subscription, and would add a request.

5. **The current cycle card uses `paidCycles[0]`** together with the courier delivery or UPS shipment the page already loaded for that invoice. The stage and the next action come from a small mapping in `src/lib/currentCycle.ts`, tested on its own.

6. **Feedback is scoped per section.** Replace the page-level `message` and `error` with a small `useSectionFeedback()` hook (state, auto-clear timer for success, a dismiss button for errors). Each section renders its own feedback. The top keeps only load failures.

7. **Confirmation uses the existing `Dialog` component**, not `window.confirm`, because it can show the invoice number and the email clearly and can be tested. Existing `window.confirm` calls on the UPS and courier flows stay as they are.

8. **Narrow screens use CSS, not a second component.** At 640px and below, the charges, delivery and UPS rows render as stacked cards (`display: block` rows with `data-label` captions) inside a page-scoped class. The memory note warns that global `table` CSS breaks other components, so these styles are scoped to the page wrapper.

9. **Plan description:** the panel uses `planLabel` unless it matches `/^Plan #\d+$/`. Otherwise it builds the text from the checkout copy (`term.months`, pets, total packs) through `parseCheckoutSnapshots`. The API label rule (`planLabelFromLedger`) does not change because other screens use it.

10. **The page is split into components:** `CurrentCycleCard`, `AttentionList`, `ChargesSection`, plus the existing courier and UPS sections moved into their own files. This keeps the page under a few hundred lines and lets each part be tested alone.

## Risks / Trade-offs

- [The guard drops a legitimate event if a subscription's stored account is wrong] → Checkout writes the account from the address, and nothing rewrites it on `invoice.paid`. The warning log names the subscription so it can be found. A wrong stored account is a bug to fix at checkout, not in the webhook.
- [The charges join misses an invoice the operator expects] → "Buscar na Stripe" stays available, and rows from any source appear even when another source is empty.
- [The per-section feedback refactor touches many handlers] → Move one section at a time, keep the existing tests green, and add one test per section for where its message appears.
- [Card layout on narrow screens hides columns' meaning] → Each cell carries its column name as a caption. Verify with Playwright screenshots at 390px and 1440px.

## Migration Plan

No schema change. Deploy the backend guard and NF-e list fields first. The panel tolerates missing `missing_fields`, `bling_problems` and `stripe_invoice_id` from an older API by falling back to the current text. Rollback is a plain revert of either side.
