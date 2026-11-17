# Tasks

## 1. Core rule

- [x] 1.1 Add `src/core/recipient-name.js` with `normalizeRecipientName` and `validateRecipientName` (2–60 chars, a `\p{L}` letter, no `@`, collapsed spaces, no reuse of `parseFiscalName`). Verify with `tests/recipient-name.test.js` covering "José", "Portaria", "12", "a@b", 60 and 61 chars, and only spaces.

## 2. API writers

- [x] 2.1 Require `recipient_name` in `OnboardingZipcodeService` (422 with field `recipient_name` when missing, empty or invalid, saved address unchanged). Verify with `npx jest --findRelatedTests src/services/onboarding-zipcode.service.js` plus new cases for the invalid name and the stored key.
- [x] 2.2 Accept `recipientName` in `ProfileService.updateDelivery` and return it in `mapDelivery`. Omitted keeps the stored value through `mergeAddress`, and an empty string is 422. This also covers the admin user delivery. Verify with profile service tests for edit, omit, empty and invalid, and an admin users route test for omit.
- [x] 2.3 Validate `recipient_name` in `subscriptions-edit.validator.js` (empty is 422). In `subscriptions-edit-commit.repository.js`, copy `row.address.recipient_name` into `payload.address` when the field is absent, before `addressWithTransit`. Verify with commit tests: a street change without the field keeps "João Lima", and a new recipient replaces it.

## 3. Checkout

- [x] 3.1 Refuse checkout with 422 `recipient_name_required` before any Stripe call when the context address lacks a valid recipient, and copy it into the subscription address. Verify with `tests/onboarding-subscription-checkout.service.test.js` cases: missing (Stripe not called) and present (ledger address holds it).

## 4. Readers

- [x] 4.1 Read `recipient_name` first in `UpsShipmentService.addressRecipient`, keeping the account-name fallback and `recipient_name_missing`. Verify with `tests/ups-shipment.service.test.js` cases for recipient over account, the old subscription fallback and the 35-char cut.
- [x] 4.2 Read `recipient_name` first in `production-queue-presenter.js`, keeping the chain that ends with the customer email. Add a test that `mail-context.firstNameFrom` ignores `recipient_name`, and a test that the NF-e and invoice customer name are unchanged by it. Verify with `npx jest --findRelatedTests src/core/production-queue-presenter.js src/core/email/mail-context.js`.

## 5. Store (`eden-bowls`)

- [x] 5.1 Add the required recipient field to the checkout address step for US and BR, pre-filled from the account name unless it has `@`, reused from the saved address, sent as `recipient_name`, and with the `recipient_name_required` code sending the customer back to the address step. Update `CHECKOUT_RULES.md`. Verify with Vitest cases for pre-fill, the email-like account name, the saved address and the 422 redirect.
- [x] 5.2 Add the field to `ProfileDeliverySection` and `EditSubscription` with pt-BR and en-US texts. Verify with the existing Vitest suites for both screens extended with the field.

## 6. Panel (`eden-bowls-admin`)

- [x] 6.1 Add the recipient to the user delivery form and show it in `SubscriptionDetailPage` (address block and UPS issue hint). Verify with Vitest cases for edit, omit and display fallback.

## 7. Integration check

- [x] 7.1 Locally, check out a US plan as "Ana Costa" with recipient "João Lima", buy the UPS label in the sandbox, and confirm the label shows João Lima and no letter greets João. Then check out a BR plan and confirm the production queue shows the recipient. Edit the subscription street and confirm the recipient is kept.
