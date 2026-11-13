# Tasks

## 1. Backend: one paid invoice, one account

- [ ] 1.1 In `handleInvoicePaid` (`src/services/stripe-webhook.service.js`), after the user context resolves and before the ledger upsert, return with `warnIgnored(event, 'account_mismatch', …)` when the stored row's `stripeAccount` differs from `runtime.account`. Verify with new cases in `tests/stripe-webhook.service.test.js`: a `br` subscription on the `us` endpoint writes no ledger, NF-e or invoice and sends no letter; the same event on `br` issues one invoice; a subscription with no stored row is handled on the delivering endpoint (`npx jest --runTestsByPath tests/stripe-webhook.service.test.js`).
- [ ] 1.2 Check that the route still answers 200 for the ignored event (`npx jest --runTestsByPath tests/stripe-webhook.routes.test.js`).

## 2. Backend: NF-e list says what to fix

- [ ] 2.1 In `listForSubscription` (`src/services/bling-nfe.service.js`), add `stripe_invoice_id`, `missing_fields` and `bling_problems` to each item using the detail's helpers, without the request and response payloads. Verify with cases in `tests/bling-nfe.service.test.js` for a blocked note, a refused note with named fields, and an authorized note (`npx jest --runTestsByPath tests/bling-nfe.service.test.js tests/bling-nfe.routes.test.js`).
- [ ] 2.2 Confirm that no route changed: `npm run routes:manifest` leaves `docs/api-routes.json` unchanged (`git diff --exit-code docs/api-routes.json`).

## 3. Panel: data helpers

- [ ] 3.1 Extend `NfeSummary` in `src/lib/nfe.ts` with optional `stripe_invoice_id`, `missing_fields` and `bling_problems`. Verify with `npx tsc -b`.
- [ ] 3.2 Add `src/lib/charges.ts` (`buildCharges`) that joins paid cycles, Eden Bowls invoices, NF-e items and fetched Stripe invoices by Stripe invoice id, newest first. Verify with `src/lib/charges.test.ts`: a full row, a cycle without an invoice, an NF-e only row, a missing source, and Stripe rows merged without duplicates (`npx vitest run src/lib/charges.test.ts`).
- [ ] 3.3 Add `src/lib/currentCycle.ts` that maps the latest paid cycle plus its courier delivery or UPS shipment to a stage, dates and next action per market. Verify with `src/lib/currentCycle.test.ts` covering each stage and no cycle.
- [ ] 3.4 Add `src/lib/attention.ts` that turns NF-e problems, the address issue, courier locks, failed deliveries and a market exception into entries with text, next step and link, reusing `missingFieldLabel`, `blingProblemGuide`, `issueCodeText` and `alertPresentation`. Verify with `src/lib/attention.test.ts`, including an older API without `bling_problems`.
- [ ] 3.5 Add the plan description rule (stored label unless it is `Plan #<id>`, else term, pets and packs from the checkout copy). Verify with a unit test.

## 4. Panel: page structure

- [ ] 4.1 Add `useSectionFeedback()` (success auto-clears, error stays until dismissed or the next action) and test the timer and the dismiss button with Vitest fake timers.
- [ ] 4.2 Split `SubscriptionDetailPage.tsx`: move the courier and UPS sections into their own components without changing behavior. Verify that `src/pages/SubscriptionDetailPage.test.tsx` still passes unchanged.
- [ ] 4.3 Add `CurrentCycleCard` at the top in place of the four metric cards (renewal shown as a day). Verify with page tests for a Brazil order out for delivery, a ready cycle, and a reader without `shipping.read`.
- [ ] 4.4 Add `AttentionList` above the sections. Verify with page tests for a blocked NF-e that links to the fill place, a refused NF-e that lists Bling fields, and no block when nothing is open.
- [ ] 4.5 Add `ChargesSection` replacing "Invoices Eden Bowls", "Notas fiscais (NF-e)" and "Faturas Stripe": "Gerar invoice" on a paid row with no invoice, and "Buscar na Stripe" merging rows. Verify with page tests for each scenario of "Charges are grouped by Stripe invoice", and keep the `#faturas-stripe` anchor pointing at the new section.
- [ ] 4.6 Put a `Dialog` confirmation naming the invoice number and the email before "Enviar ao cliente" and "Reenviar". Verify with a test that cancelling sends no request.
- [ ] 4.7 Move each section's action results to that section with `useSectionFeedback`. Verify with a test that a resend message renders inside the charges section.
- [ ] 4.8 Show the customer name as the title with the email below, the plan description, the `price_…` id in the technical block, "Abrir cadastro" and "Ver checkout" as link labels, and Stripe ids as secondary text. Verify with page tests.
- [ ] 4.9 In the Brazil delivery section, show the charged freight next to each courier cost and the address phone next to the recipient. Verify with a page test.
- [ ] 4.10 Show the plan subtotal and the first invoice once when equal (`LedgerSnapshotSections`). Verify with its test.

## 5. Panel: narrow screens

- [ ] 5.1 Add page-scoped styles that render the charges, delivery and UPS rows as cards at 640px and below, with column captions, without touching global `table` CSS. Verify with a Playwright spec at 390px asserting that "Entregue", "Falhou" and "Cancelar" are in the viewport and that `document.documentElement.scrollWidth <= 390`.

## 6. Integration check

- [ ] 6.1 Run the related backend tests (`npx jest --changedSince=main`) and the panel's related tests (`npm run test:related` on the changed files, then `npm run lint` and `npm run build`).
- [ ] 6.2 Take Playwright screenshots of a Brazil subscription and a US subscription at 1440px and 390px and review them before handing off: current cycle on top, attention block, one charges row per Stripe invoice, no horizontal scroll.
