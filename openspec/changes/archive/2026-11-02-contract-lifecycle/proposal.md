# Proposal

## Why

Changing a plan's term keeps counting deliveries already paid, so a customer who moves from 3 to 6 months gets 3 more deliveries, not 6, while the edit screen says the cycle restarts. Plan-end dates, the end of a contract with renewal off, and the renewal notice all read that count, so all of them are wrong after a term change.

## What Changes

- A term change starts a new contract, with the full new term, at the next charge.
- Deliveries charged before the change stop counting toward the new contract.
- A term change on a plan that is ending because renewal is off keeps the plan running for the new contract. An explicit cancellation stays in place.
- The edit review states what actually happens, replacing "billing cycle resets now".
- The edit review shows only what the edit charges or credits now, not the whole next invoice.
- An edit that needs card authentication is detected on the current Stripe API.
- Define "contract more": on an active plan it is a term change or renewal on the same subscription, and after a plan ends it is a new subscription. The existing block on a second subscription for a covered pet stays.

## Capabilities

### New Capabilities

- `subscription-contract`: What a contract is, how its deliveries are counted, and what starts or ends one.

### Modified Capabilities

- `plan-notices`: The renewal notice counts only deliveries of the current contract.

## Impact

- Backend: a new migration on `stripe_subscriptions`, `src/core/contract-deliveries.js`, `src/core/plan-notice.js`, `src/infrastructure/entities/stripe-subscription.entity.js`, `src/infrastructure/repositories/subscription-ledger.repository.js`, `src/infrastructure/repositories/subscriptions-edit-commit.repository.js`, `src/infrastructure/repositories/subscription-deliveries.repository.js`, `src/infrastructure/repositories/subscriptions-actions.repository.js`, `src/services/stripe-webhook.service.js`.
- Store (`eden-bowls`): the review text in `src/pages/dashboard/pages/EditSubscription.tsx` and the PT and EN texts.
- Panel: no change. It does not read the delivery count.
- Backend, every plan edit: `src/core/subscription-edit-plan.js` and how the edit commit reads the invoice.
- Stripe: no change to prices or billing dates. One call clears a scheduled end when a term change keeps the plan running. An edit that lowers the amount no longer invoices a credit at once.
- No route is added, renamed, or removed.
