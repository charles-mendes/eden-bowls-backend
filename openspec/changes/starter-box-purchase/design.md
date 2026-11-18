# Design

## Context

- **Checkout:** `OnboardingSubscriptionCheckoutService.checkout` validates consent (`legal_consent`, `renewal_consent`), address, delivery area, CPF and fiscal name (BR), resolves the first-purchase promotion from `OnboardingDiscountEligibilityRepository`, and calls `stripeBilling.createOnboardingSubscription`. That creates one Stripe subscription with the catalog prices, the promotion coupon (`duration: once`) and the shipping as `add_invoice_items`.
- **What a paid invoice drives:** `invoice.paid` → `recordChargedDelivery` → ledger → `paidCycles.recordPaid`. From the cycle come the production queue, stock separation, UPS labels, courier deliveries, NF-e (Bling) and the order-confirmed letter. All of it keys on a subscription invoice.
- **Pack math:** `simplified-consumption.js` picks each pet's pack size from its monthly grams (`planDays` from plan settings) and rounds up the pack count.
- **Eligibility:** the first-purchase eligibility looks at a paid checkout reference, old WooCommerce orders and active subscriptions by user or email.
- **CPF:** every BR checkout already requires a valid CPF (`tax_document_required`) and stores it.
- **Card:** the checkout receives a `pm_` id. Stripe exposes `card.fingerprint` on the payment method, and the fingerprint is per Stripe account.

## Goals / Non-Goals

**Goals:**
- A Starter goes through the same paid-invoice pipeline as a plan, so the kitchen, labels, courier, NF-e and letters work without a second order model.
- The one-per-customer check runs before Stripe charges anything.

**Non-Goals:**
- Moving from the Starter to the monthly plan, its prefill and the 5th-day email (change `starter-to-monthly`).
- Shipping price rules (change `us-company-paid-shipping`).
- Matching customers by address, device or name.

## Decisions

1. **A Starter is a Stripe subscription created with `cancel_at_period_end: true` and metadata `plan_kind: starter`.** It charges its first invoice and never renews. The alternative, a standalone Stripe invoice or PaymentIntent, would leave the production cycle, labels, courier, NF-e and letters without the subscription invoice they all read. A Stripe subscription schedule would also work, but adds an object no other flow uses.
2. **The Starter uses the plan's recurring catalog prices with quantities for the Starter days.** No new Stripe prices. `catalog_pricing` is built by the same code with `days = starter_days`. The ledger stores `plan_kind`, `auto_renew: false` and term 1, so contract logic that reads a term does not break. `endContractAfterLastDelivery` is skipped for a Starter, because the subscription already ends.
3. **The Starter discount is a Stripe coupon (`percent_off`, `duration: once`) restricted with `applies_to.products` to the food products of the account.** The shipping product is not in that list, so shipping is never discounted, whatever Stripe does with subscription-level discounts on `add_invoice_items`. The coupon is found or created per account and percent, with metadata `eden_kind: starter`, and reused across checkouts. The alternative, a lower unit amount per line, would need ad-hoc prices and would hide the discount on the invoice and the NF-e.
4. **`starter_box_claims` table (`id`, `user_id`, `stripe_account`, `email_normalized`, `tax_document`, `card_fingerprint`, `stripe_subscription_id`, `status` `pending` | `paid` | `void`, timestamps), with indexes on each key.** The checkout inserts a `pending` claim, after the limit check and before Stripe. `invoice.paid` of a Starter turns it `paid`. A failed creation, or an incomplete subscription that expires, turns it `void`. A pending claim of the same user is reused, so retries pass. A pending claim of another user blocks, to stop two accounts racing the same card. The alternative, querying Stripe for earlier fingerprints, is slow and cannot see CPF or email across accounts.
5. **The fingerprint is read with `paymentMethods.retrieve` on the checkout's Stripe account before the claim.** A payment method without a card fingerprint (not a card) is refused with 422 `invalid_payment_method`, as the checkout only takes cards.
6. **Returning customers are refused from the ledger**: any `stripe_subscriptions` row of the user, or of the same email, that has `charged_deliveries > 0` or a paid `last_charged_invoice_id`, plus the existing old-orders check. The plan snapshot uses the same function, so it never offers a Starter the checkout refuses.
7. **No first-purchase coupon on a Starter**: the checkout does not call `resolveFirstPurchasePromotionForCheckout` when `plan_kind` is `starter`.
8. **Consent:** `renewal_consent` is skipped for a Starter. `legal_consent` stays.
9. **Plan settings gain `starter_days` and `starter_discount_percent`**, saved through the existing `PUT /api/v1/admin/catalog/plan-settings`. A percent change applies to the next Starter checkout, because the coupon is found by percent.
10. **Letters:** the mailer reads `plan_kind` and skips the cancelled letter for a Starter. The order-confirmed letter gets a Starter variant of its text (BR and US).

## Risks / Trade-offs

- [The Starter subscription stays `active` in Stripe until its period end, about a month] → It never charges again. Other flows read `plan_kind` and ignore it as a running plan (the dashboard and the move to monthly are in `starter-to-monthly`).
- [A family member with the same card is blocked] → Accepted by the client. Support can void a claim by hand in the database. An admin action can come later.
- [Two customers create a fresh account each and use different cards and emails] → In BR the CPF still matches. In the US only email and card match. Accepted.
- [`applies_to.products` misses a food product created later] → The coupon is looked up by percent and product set, so a new product set creates a new coupon. Tested with a product added after the first coupon.
- [The current first-purchase coupon has no `applies_to`, so Stripe may already discount shipping on plans] → Out of scope here. Task 3.2 checks this in test mode and records the result in the change notes.

## Migration Plan

1. Migration `1700000000085`: adds `starter_days` (10) and `starter_discount_percent` (40) to `plan_settings`, `plan_kind` (`subscription` default) to `stripe_subscriptions`, and creates `starter_box_claims`. `down` drops the table and the columns.
2. Deploy the API, then the panel, then the store. The store hides the Starter until the API returns `starter`.
3. Publish the new Terms and Privacy Policy in the admin before announcing the Starter.
4. Rollback: revert the builds and run `down`. Starters already sold end on their own at their period end.
