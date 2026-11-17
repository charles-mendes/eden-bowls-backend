# Design

## Context

See proposal.md for motivation and the delta specs for requirements.

- `charged_deliveries` is a lifetime count, backed by `subscription_charged_invoices`. `contract-deliveries.js` derives the contract from it with `paid % term`.
- That count is read in `stripe-webhook.service.js` (`endContractAfterLastDelivery`), `subscriptions-actions.repository.js` (`lastDeliveryCharged`), `subscription-deliveries.repository.js` (`mapDeliverySubscription`, on two read paths), and `plan-notice.js`.
- `subscriptions-edit-commit.repository.js` saves the new term, or stores it in `editPending` until `stripe-webhook.service.js` promotes it.
- A term change does not move the billing date. The edit calls `updateSubscriptionItems` with proration only.
- There is no production data yet, only QA.

## Goals / Non-Goals

**Non-Goals:**

- Changing prices or discounts.
- A separate "contract more" screen or adding months to an end date.
- Showing a contract history.
- Recalculating subscriptions already changed in QA.

## Decisions

### Store a base, keep the lifetime count

A new column `contract_start_charged` (INT, NOT NULL, default 0) holds `charged_deliveries` at the moment the contract started. The contract count is `charged - base`. Resetting `charged_deliveries` was rejected: seeding, invoice deduplication, and the fallback from Stripe invoices all rebuild the lifetime count, and they would undo a reset.

### One helper applies the base

`contractPaid(paid, row)` in `contract-deliveries.js` returns `max(0, paid - base)`, keeping null as null. Every reader passes through it before the existing `paid % term` rules, including the Stripe invoice fallback in `lastDeliveryCharged`. Those rules stay unchanged.

### The base is set by the database

`startContract(subscriptionId)` runs `SET contract_start_charged = COALESCE(charged_deliveries, 0)`, so it uses the stored value and not one read earlier in the request. It runs on commit without a pending payment and on promotion of `editPending`, only when the term differs, always before the new term is written. Both steps are safe to repeat, so a failure leaves a state that saving again repairs. The pending record keeps `term_changed`, because the promotion no longer sees the old term after writing the new one.

### A null count is seeded before the change

With `charged_deliveries` null, a base of 0 would count all earlier invoices once seeded. The commit seeds it from Stripe, as the webhook does, before calling `updateSubscriptionItems`. If that read fails, the edit is refused with no change in Stripe or the ledger.

### Scheduled end is cleared only for renewal off

The commit calls `setCancelAtPeriodEnd(false)` when the term changes, `autoRenew === false`, and `cancelAtPeriodEnd` is true. A stored `autoRenew` of true or null means an explicit cancellation, the same reading `plan-notice.js` uses. With a pending payment, this also waits for the promotion. The next-contract end then comes from the existing `endContractAfterLastDelivery`.

### Due now comes from the proration lines

`invoices.createPreview` returns the next invoice: the regular cycle plus any proration. `mapProrationFromInvoice` now sums only proration lines, net of discounts and with exclusive tax, instead of `amount_due`. A balance the customer already holds is not an effect of the edit, so it no longer shows as a credit. A local read showed a term change at the full next invoice and a pack removal, a credit of R$ 44,84, as a charge of R$ 1.237,66. `always_invoice` follows that amount, so a credit stops being invoiced at once.

### Edit reads the invoice through `extractInvoicePayment`

The edit read `invoice.payment_intent`, which the API version in use no longer returns. It now uses the shared extractor, which reads `confirmation_secret`. A paid invoice never holds the edit.

### Renewal notice needs no new rule

`nextChargeStartsContract` applies `contractPaid`. Right after a term change the contract count is 0, so no notice goes out for the first charge of the contract the customer just chose.

## Risks / Trade-offs

- [`startContract` fails after the Stripe item update] → The old term stays saved and the error reaches the customer. Saving the change again repeats the steps.
- [Clearing the scheduled end fails after the Stripe item update] → The call runs before the ledger write, so the edit fails visibly and the customer can retry.
- [A customer can change term repeatedly to reset the count] → Accepted: renewal has no lock-in today, and charges are unaffected.
- [Subscriptions changed before this deploy keep base 0] → Accepted, since there is no production data.

- [Tax and discounts on a proration are not exercised by the BR test account] → Covered by unit tests only.
- [A customer balance lowers a real charge, but the review shows the charge before it] → Rare, and the customer pays less than shown, never more.

## Migration Plan

Deploy the backend with the migration, then the store. The default of 0 keeps every current count. Rollback: revert the code; the column is harmless.
