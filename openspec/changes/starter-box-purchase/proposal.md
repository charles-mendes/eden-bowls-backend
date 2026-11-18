# Proposal

## Why

The client defined the Starter Box (docs-new/FEATURE_MEDIDAS_CAIXAS/decisoes-starter-box.md, answers of 17/11/2026). It is an optional 10-day trial: after seeing the calculated plan, a new customer either buys the Starter or subscribes directly to a 1, 3 or 6-month plan. The Starter has 40% off its food and never turns into a monthly plan by itself. Each customer can buy it once, checked by account email, CPF and card. Today the store only sells the monthly subscription.

## What Changes

- The plan snapshot offers a `starter` option next to `plan_terms`: whether the customer can buy it, the Starter days, the discount percent, the packs and the food prices. Pack counts use the Starter days in place of the plan days.
- The existing checkout (`POST /api/v1/onboarding/subscription/checkout`) sells a Starter when the saved plan selection has `plan_kind: "starter"`:
  - one charge, with the Starter discount on the food lines only. Shipping is never discounted;
  - the Stripe subscription is created to end at its period end, so it never renews and never charges again;
  - the renewal consent is not asked, because there is no renewal. The Terms and Privacy consent still is;
  - no first-purchase term discount applies to the Starter.
- One Starter per customer. A Starter is refused with 409 `starter_already_used` when the account email, the CPF (BR) or the card fingerprint (per Stripe account) already has a Starter, and with 409 `starter_returning_customer` when the customer already paid for any plan before.
- Plan settings gain the Starter days (10 on deploy) and the Starter discount percent (40 on deploy), per market, editable in the admin.
- The ledger records the plan kind (`subscription` or `starter`). The admin subscription list, the subscription detail, the production queue and the courier and label queues show it.
- A Starter ending at its period end does not send the scheduled-cancellation letter, nor the renewal or plan-ending notice.
- Out of scope: the move from the Starter to the monthly plan and the 5th-day email (change `starter-to-monthly`), free US shipping (change `us-company-paid-shipping`), box weights (change `shipping-boxes-real-weights`).

## Capabilities

### New Capabilities

- `starter-box`: the Starter offer, its price, its purchase and the one-per-customer limit.

### Modified Capabilities

- `plan-settings`: Starter days and Starter discount percent per market.
- `transactional-emails`: a Starter does not get the scheduled-cancellation letter.
- `plan-notices`: a Starter gets no renewal or plan-ending notice.

## Impact

- New migration `1700000000085`: `plan_settings` gains `starter_days` and `starter_discount_percent`; `stripe_subscriptions` gains `plan_kind`; new table `starter_box_claims`.
- Edited: plan snapshot repository and pack math (`simplified-consumption.js`), plan selection validator, `onboarding-subscription-checkout.service.js` and its repository, `stripe-billing-client.js` (Starter coupon restricted to food products, `cancel_at_period_end`), `stripe-coupon.service.js`, plan settings service and validator, admin subscription and queue presenters, transactional mailer.
- No new route: `docs/api-routes.json` does not change.
- Sibling changes `starter-box-purchase` in `eden-bowls` (store) and `eden-bowls-admin` (panel). Deploy the API first.
- **Launch blocker outside code:** the published Terms (version 2026-10-22) describe the Starter with a 3-month commitment and a fee on early cancellation. A new version of the Terms and Privacy Policy must be published in the admin before the Starter goes live.
