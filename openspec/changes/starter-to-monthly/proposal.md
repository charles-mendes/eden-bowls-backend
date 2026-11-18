# Proposal

## Why

A Starter (change `starter-box-purchase`) never turns into a monthly plan by itself: the customer has to confirm it. The client's rules (docs-new/FEATURE_MEDIDAS_CAIXAS/decisoes-starter-box.md) say the monthly plan opens from the Starter's delivery (Day 1), one email invites the customer on Day 5 even when the delivery was not confirmed, and the first monthly charge after a Starter has no first-purchase discount. Today the checkout would even refuse the monthly plan: the Starter's pets count as already subscribed, so a second checkout with the same pets fails with 409 `checkout_context_mismatch`.

## What Changes

- **Day 1** of a Starter is its confirmed delivery date (UPS tracking delivered in the US, courier marked delivered in BR), or its expected delivery date when no delivery was confirmed and that date has come.
- The subscription detail (`GET /api/v1/subscriptions/:subscriptionId/detail`) of a Starter returns a `starter` block: Day 1, whether it is confirmed or expected, whether the monthly plan is open, and the Starter's recipes and proportions for the store to prefill the plan.
- A monthly checkout from a Starter customer:
  - is refused with 409 `starter_not_delivered` before Day 1;
  - is not blocked by the Starter's pets, and never reuses the Starter's checkout;
  - gets no first-purchase discount: the first charge is the plan's regular price (eligibility reason `STARTER_PURCHASED`). A customer who subscribes directly keeps today's 10, 25 or 40 percent.
- **Day-5 invite:** a scheduled tick sends one email per Starter on Day 1 + 4, linking to the plan. It is not sent when the customer already confirmed a monthly plan. When Day 1 was the expected date, the operation gets an alert in Today.
- Confirming the monthly plan charges at once. The first monthly delivery date is the one the delivery calendar gives. "3 business days" is an operations target, not a promise shown in the store.
- Out of scope: the Starter purchase (change `starter-box-purchase`), shipping prices (change `us-company-paid-shipping`).

## Capabilities

### New Capabilities

- `starter-conversion`: Day 1 of a Starter, when the monthly plan opens, and the monthly checkout of a Starter customer.

### Modified Capabilities

- `first-purchase-discount`: no first-purchase discount after a Starter.
- `transactional-emails`: the Day-5 invite letter.
- `background-jobs`: the tick that sends the Day-5 invites.
- `admin-today`: the alert for a Starter whose delivery was not confirmed.

## Impact

- New migration `1700000000086`: `starter_box_claims` gains `invite_sent_at`, `invite_day1`, `invite_day1_source` (`confirmed` | `expected`) and `alert_resolved_at`.
- New `src/core/starter-day-one.js` (pure Day 1 rule). New `starter_invites` job in `background-jobs.service.js` and a `starter-invite.service.js`.
- Edited: `onboarding-discount-eligibility.repository.js`, `onboarding-subscription-checkout.service.js` (`collectSubscribedPetIds`, checkout reuse), `checkout-idempotency.js`, subscriptions detail repository and presenter, transactional mailer and copy, admin Today service and counts repository.
- No new route: `docs/api-routes.json` does not change.
- Sibling changes `starter-to-monthly` in `eden-bowls` (store) and `eden-bowls-admin` (panel). Needs `starter-box-purchase` deployed first.
