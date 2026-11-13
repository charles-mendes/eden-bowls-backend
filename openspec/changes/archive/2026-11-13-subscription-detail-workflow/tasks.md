# Tasks

## 1. Backend: one paid invoice, one account

- [x] 1.1 Extend `warnIgnored` in `src/services/stripe-webhook.service.js` to log optional `stored_account`, `subscription_id` and `invoice_id` from `extra`, leaving existing callers unchanged. Verify with a case in `tests/stripe-webhook.service.test.js` asserting the logged fields.
- [x] 1.2 In `handleInvoicePaid`, read the stored row once right after `resolveUserContext`. When its `stripeAccount` differs from `runtime.account`, call `warnIgnored(event, 'account_mismatch', …)` and return before `startNewContract`, then reuse that row below. Verify with cases in `tests/stripe-webhook.service.test.js`:
  - a `br` subscription on the `us` endpoint: no `startNewContract`, ledger upsert, checkout reference update, NF-e row, production cycle, charged delivery, invoice issuance, letter or Stripe write;
  - a pending term change on the wrong endpoint stays pending;
  - the same event on `br` issues one invoice;
  - a subscription with no stored row is handled on the delivering endpoint.

  Run `npx jest --runTestsByPath tests/stripe-webhook.service.test.js`.
- [x] 1.3 Check that the route answers 200 for the ignored event and that the event is recorded as processed (`npx jest --runTestsByPath tests/stripe-webhook.routes.test.js tests/stripe-webhook-events.test.js`).

## 2. Backend: NF-e list says what to fix

- [x] 2.1 In `listForSubscription` (`src/services/bling-nfe.service.js`), add `stripe_invoice_id`, `missing_fields` and `bling_problems` to each item using the detail's helpers, without the request and response payloads. Verify with cases in `tests/bling-nfe.service.test.js` for a blocked note, a refused note with named fields, and an authorized note (`npx jest --runTestsByPath tests/bling-nfe.service.test.js tests/bling-nfe.routes.test.js`).
- [x] 2.2 Confirm that no route changed: `npm run routes:manifest` leaves `docs/api-routes.json` unchanged (`git diff --exit-code docs/api-routes.json`).

## 3. Panel: data helpers

- [x] 3.1 Extend `NfeSummary` in `src/lib/nfe.ts` with optional `stripe_invoice_id`, `missing_fields` and `bling_problems`, and add `account_name` to the page's `SubscriptionDetail` type. Verify with `npx tsc -b`.
- [x] 3.2 Add `src/lib/charges.ts` (`buildCharges`) that joins paid cycles, Eden Bowls invoices, NF-e items and fetched Stripe invoices by Stripe invoice id, newest first. Amount: Eden Bowls `total_minor`, else Stripe `amountPaid / 100` with currency, else "—". On two Eden Bowls invoices for one key, the subscription's account is primary and the other goes into `otherInvoices`. Verify with `src/lib/charges.test.ts`:
  - a full row;
  - a cycle without an invoice;
  - an NF-e-only row and an NF-e without `stripe_invoice_id`;
  - a missing source;
  - the Stripe amount in minor units;
  - the `br`/`us` duplicate;
  - Stripe rows merged without duplicates.

  Run `npx vitest run src/lib/charges.test.ts`.
- [x] 3.3 Add `src/lib/currentCycle.ts`: select the oldest paid cycle not delivered, else the newest; delivered from the courier delivery or the page's UPS shipment (status or tracking `delivered`). Map the stage and action per the spec table, filtered by `shipping.write`, and count the other paid cycles not delivered. Verify with `src/lib/currentCycle.test.ts` covering:
  - each row of the stage table;
  - the November-on-the-road/December-paid selection;
  - all delivered;
  - no cycle;
  - a voided UPS shipment ignored.
- [x] 3.4 Add `src/lib/attention.ts` that turns NF-e problems (linking to `/operations/nfe/:id`), an address issue with `open: true`, courier locks, failed deliveries and a market exception into entries with text, next step and link. Reuse `missingFieldLabel`, `blingProblemGuide`, `issueCodeText` and `alertPresentation`. Verify with `src/lib/attention.test.ts`, including `open: false`, an older API without `bling_problems`, and nothing open.
- [x] 3.5 Add the plan description rule (stored label unless it is `Plan #<id>`, else term, pets and packs from the checkout copy). Verify with a unit test.

## 4. Panel: page structure

- [x] 4.1 Add `useSectionFeedback()` (success auto-clears, error stays until dismissed or the next action) and test the timer and the dismiss button with Vitest fake timers.
- [x] 4.2 Split `SubscriptionDetailPage.tsx`: move the courier and UPS sections into their own components without changing behavior. Verify that `src/pages/SubscriptionDetailPage.test.tsx` still passes unchanged.
- [x] 4.3 Add `SubscriptionHeader` in place of the four metric cards: title `account_name || email`, the email below a name, the status, "renova em" or "termina em" as a day, and the pause/cancel note. Verify with page tests for a name, no name, and cancel at period end.
- [x] 4.4 Add `CurrentCycleCard` below the header, wired to the existing handlers, with the count of other waiting cycles. Verify with page tests for a Brazil order out for delivery, a UPS shipment in transit, blocked production, a reader without `shipping.write`, and a reader without `shipping.read`.
- [x] 4.5 Add `AttentionList` above the sections. Give the "Problema de endereço" section an `id` and link its entry to it, and remove the standalone market-exception warning in favor of its entry. Verify with page tests for:
  - a blocked NF-e linking to the note;
  - a refused NF-e listing Bling fields;
  - an open address problem linking to its section, which keeps the contact action;
  - a closed address problem not listed;
  - the market exception shown once;
  - no block when nothing is open.
- [x] 4.6 Add `ChargesSection` with `id="faturas-stripe"`, replacing "Invoices Eden Bowls", "Notas fiscais (NF-e)" and "Faturas Stripe". It offers "Gerar invoice" on a paid row with no invoice, "PDF Stripe" on every row, the other duplicate invoice named with its download, and "Buscar na Stripe" merging rows. Verify with page tests for each charges scenario. Keep the existing `#faturas-stripe` scroll test passing, updated only for the section's new heading.
- [x] 4.7 Put a `Dialog` confirmation naming the invoice number and the email before "Enviar ao cliente" and "Reenviar". Verify with a test that cancelling sends no request.
- [x] 4.8 Move each section's action results to that section with `useSectionFeedback`. Verify with a test that a resend message renders inside the charges section.
- [x] 4.9 Show the plan description, move the subscription and `price_…` ids to secondary text or the technical block, and label the links "Abrir cadastro" and "Ver checkout". Verify with page tests.
- [x] 4.10 In the Brazil delivery section, show the checkout freight (`shipping.cost`) next to each courier cost and the address phone next to the recipient. Verify with a page test.
- [x] 4.11 In `LedgerSnapshotSections`, show only "Subtotal do plano" when it equals the first invoice. Verify with its test.

## 5. Panel: narrow screens

- [x] 5.1 Add page-scoped styles that render the charges, delivery and UPS rows as cards at 640px and below, with column captions, without touching global `table` CSS. Verify with a Playwright spec at 390px asserting that "Entregue", "Falhou" and "Cancelar" are in the viewport and that `document.documentElement.scrollWidth <= 390`.

## 6. Integration check

- [x] 6.1 Run the related backend tests (`npx jest --changedSince=main`) and the panel's related tests (`npm run test:related` on the changed files, then `npm run lint` and `npm run build`).
- [x] 6.2 Take Playwright screenshots of a Brazil subscription and a US subscription at 1440px and 390px and review them before handing off: header and current cycle on top, attention block, one charges row per Stripe invoice, no horizontal scroll.
