# Design

## Context

- The delivery address is a JSON column in `onboarding_user_state.address`. It is written by `POST /api/v1/onboarding/address` (`OnboardingZipcodeService`, which builds a fixed whitelist of keys) and by `ProfileService.updateDelivery` (`mergeAddress` with a fixed patch). Checkout copies `context.address` into the ledger subscription `address` (`onboarding-subscription-checkout.service.js`). The subscription edit validator accepts address keys with `passthrough()`.
- No writer stores a name today. Readers fall back on `address.name || address.full_name || address.recipient`: `UpsShipmentService.addressRecipient`, `production-queue-presenter.js:200`, and `mail-context.js firstNameFrom`. The last one is the email greeting.
- `UpsShipmentService.resolveRecipientName` falls back to the account `displayName` and treats a name with `@` as missing. The UPS client already cuts `Name`/`AttentionName` to 35 characters.
- NF-e and invoices take the name from the Stripe customer or the Bling contact, not from the address.

## Goals / Non-Goals

**Goals:**
- One canonical key, the same in both markets and in every writer.
- No change to email greetings, NF-e or invoices.

**Non-Goals:**
- A recipient phone number (the address already carries `phone`).
- Backfilling existing subscriptions. They keep the account-name fallback.
- Changing the account name from the checkout.

## Decisions

### Key `recipient_name`, never `name`
Writing `address.name` would silently change the email greeting, because `firstNameFrom` reads `address.name` first. `recipient_name` is a new key. Readers that mean "who receives" (UPS, the production queue, the courier change) read `recipient_name` first, then their current fallbacks. `mail-context.js` is left unchanged, and a test pins that it ignores `recipient_name`.
Alternative: reuse `address.recipient`, which is already in the fallback chain. Rejected because `firstNameFrom` also reads `recipient`.

### One normalizer in `src/core/recipient-name.js`
`normalizeRecipientName(value)` trims, collapses spaces and returns the name or `null`. `validateRecipientName` enforces 2 to 60 characters, at least one `\p{L}` letter (regex with the `u` flag) and no `@`. It does not reuse `parseFiscalName` from `src/core/tax-document.js`, which requires two words: "Portaria" or "Ana" are valid recipients and invalid fiscal names.

### Missing field: required in checkout, kept elsewhere
The writers store the address in two ways:
- `POST /api/v1/onboarding/address` (`OnboardingZipcodeService` → `saveZipcode`) replaces the whole JSON. A missing recipient would erase it, so this call requires the field. Missing or empty is 422.
- `ProfileService.updateDelivery` (profile and `PATCH /api/v1/admin/users/:userId/delivery`) uses `mergeAddress`. When `payload.recipientName === undefined`, the key stays out of the patch and the stored value is kept. An empty string is 422.
- The subscription edit commit (`subscriptions-edit-commit.repository.js`) does `savedAddress = payload.address ? addressWithTransit(payload.address, shipping) : row.address`, so it replaces the whole address. Before `addressWithTransit`, when `payload.address.recipient_name === undefined` and `row.address.recipient_name` exists, the stored value is copied in. An empty string is 422 in the edit validator (`subscriptions-edit.validator.js`), so the preview refuses it too. `withLedgerMarket` already forces the address country to the ledger market, and the recipient does not interact with it.

### Fallbacks stay where they are
`firstNameFrom` (`mail-context.js`) reads `address.name`, `full_name`, `recipient` and `customerName`. No writer fills these today, so greetings are generic or empty and stay that way. This change does not make greetings use the account name. The only promise is that they never use `recipient_name`. The production queue presenter reads `recipient_name` first, then its current chain, ending with the customer email. The ledger queue row carries no `displayName` (`mapQueueRow` sets `null`), and no join is added. UPS reads `recipient_name` first in `addressRecipient`, and `resolveRecipientName` keeps its display-name fallback.

### Checkout check before Stripe
`validateCheckoutState` (or a check right after it) throws 422 `recipient_name_required` when `context.address.recipient_name` is not valid. This sits beside the existing delivery-area check, before any Stripe call. The store maps this code to "go back to address".

### Pre-fill in the store
The store already has the profile `displayName` (`splitDisplayName` in `Checkout.tsx`). It pre-fills `recipientName` from it unless it contains `@`. A saved address with `recipient_name` wins over the account name. The value is sent as `recipient_name` in `syncZipcodeToApi`.

### Label length
The limit is 60 characters for courier and display use. The UPS label keeps the existing 35-character cut in the UPS client, so nothing new is needed there beyond the spec test.

## Risks / Trade-offs

- [Customers with an old saved address hit the 422 at payment] → The store sends them to the address step with the field pre-filled. It costs one extra click once.
- [Subscriptions created before the change keep the account name] → This is intended. The customer can set a recipient through the subscription address edit.

## Migration Plan

No schema change. Deploy the API first: the new key is optional for readers, and the 422 only fires on checkout. Deploy the store right after, so the checkout sends the field. Rollback: revert the store, then the API. Stored `recipient_name` values are harmless to older code.
