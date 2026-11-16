# Tasks

## 1. Contract count

- [x] 1.1 Add migration 061 with `contract_start_charged` and map it in the entity and `mapRow`; verify with a new migration test and by applying it locally.
- [x] 1.2 Add `contractPaid` to `src/core/contract-deliveries.js`; verify with unit tests for no base, a base, a null count, and a count below the base.
- [x] 1.3 Apply `contractPaid` in `endContractAfterLastDelivery`, `lastDeliveryCharged`, `mapDeliverySubscription`, and `nextChargeStartsContract`; verify with `npx jest --runTestsByPath tests/stripe-webhook.service.test.js tests/subscriptions-actions.repository.test.js tests/subscription-deliveries.repository.test.js tests/plan-notice.test.js`, with new cases for the 3 to 6 and renewal-on scenarios.

## 2. Term change

- [x] 2.1 Add `startContract` to the ledger repository; verify with a test that the SQL reads the stored count and handles null.
- [x] 2.2 In the edit commit, seed a null count before the Stripe update and refuse the edit when that read fails; verify with a test that nothing reaches Stripe on failure.
- [x] 2.3 In the edit commit, start the contract and clear a renewal-off scheduled end when the term differs; verify tests cover 1 to 3, 3 to 6, 4 to 6, 6 to 3, the same term, and an explicit cancellation.
- [x] 2.4 Store `term_changed` in `editPending` and apply both effects when the webhook promotes it; verify a webhook test shows nothing changes before the invoice is paid.

## 3. Store

- [x] 3.1 Replace `billingCycleResets` with the new-contract text in PT and EN and use it in `EditSubscription.tsx`; verify with `npx vitest run src/pages/dashboard/pages/EditSubscription.test.tsx`, including that the old text is gone.

## 4. Amount due on an edit

- [x] 4.1 Sum only proration lines in `mapProrationFromInvoice`; verify with tests using the Stripe line shapes for a term change, one more pack, one fewer pack, a discount, exclusive tax, and an existing customer balance.
- [x] 4.2 Read the edit's invoice with `extractInvoicePayment`; verify tests cover an open invoice with `confirmation_secret` and a paid invoice.

## 5. Integration

- [x] 5.1 On a local test subscription, change the term from 1 to 3 months and confirm the plan page shows 3 deliveries left and the next charge date is unchanged.
- [x] 5.2 Run `npx jest --changedSince=main` in the backend and the related Vitest files in the store.
