# Design

## Context

- **Checkout shipping:** the store asks `POST /shipping/v1/calculate`, sends the selected quote to `onboarding-shipping-select`, which stores `cost`, `total` and a signed `quote_token`. The checkout checks the token (`assertVerifiedDeliveryArea`) and passes `shipping` to `createOnboardingSubscription`, which adds `add_invoice_items` and the `shipping_amount_minor` metadata when the cost is above 0.
- **Renewals:** `invoice.created` adds a shipping item from `shipping_amount_minor` and `shipping_product_id`, or skips it when the amount is 0.
- **Edits:** `subscriptions-edit-preview.repository.js` adds `shippingCostFrom(shipping)` to the preview totals, and the commit carries it to Stripe.
- **UPS cost:** `ups_shipments` already stores `quoted_shipping_cost` and `ups_monetary_value` for each label.
- **BR price:** `applyShippingFee` prices by distance once per order. The number of boxes never enters the price, and this change keeps it so.
- **Settings and history:** shipping settings are saved by `PUT /api/v1/admin/shipping/settings` with `shipping.write` scoped by market. Company profile and life-stage settings already return a `history` read from `admin_audit_events` with `listByActionPrefix`, written with `createIn` inside the save transaction.
- **Invoice:** `invoice-document.js` sums the invoice lines whose product is the shipping product and prints the sum on the shipping row, so a free shipping prints $0.00.

## Goals / Non-Goals

**Goals:**
- One rule decides the customer's shipping per market and per subscription, used by quote, checkout, preview, tax quote, edit, renewal and invoice.
- The store shows the original and the charged amount from API fields, with no rule or amount of its own.
- A US operator changes the switch and every change is traceable.

**Non-Goals:**
- Applying a switch change to existing subscriptions (decided with the user: each subscription keeps its checkout condition).
- Quoting the US company cost with the real boxes of each order. The quote keeps the settings `package`. The label records the real cost.
- Stripe's hosted invoice. It shows no shipping line when shipping is free. Customers receive the Eden Bowls PDF.

## Decisions

1. **`customerShipping({ market, quote, chargeEnabled })` in `src/core/customer-shipping.js`** returns `{ original_amount, charged_amount, charge_enabled, company_cost }`. US: `original_amount` = quote, `charged_amount` = `chargeEnabled ? quote : 0`. BR: `original_amount` = `charged_amount` = the distance fee, one per order, and `charge_enabled` true. Every caller uses it. The alternative, setting the US quote to 0 at the source, would lose the original the store strikes through and break the signed token check.
2. **The quote response and the selected shipping carry the three fields.** `cost` stays the signed quote, so the token check still compares it. The checkout sends `charged_amount` to Stripe.
3. **The condition lives on the subscription, not in the settings.** The checkout writes Stripe metadata `shipping_waived` (`true` | `false`) and `shipping_original_minor`, and the same in the ledger shipping snapshot. `invoice.created` reads only the metadata. Edits read the snapshot: a waived subscription stays at 0; a charged one is priced with the edit's quote. The ledger shipping cost of a waived subscription is 0, so the renewal fallback to the ledger never charges the quote. Subscriptions without `shipping_waived` read as charged. This follows the decision that a switch change only affects new checkouts.
4. **`charge_shipping` is a column of `shipping_us_settings`**, saved under `us`. The save runs in a transaction that writes the setting and, when the value changes, an audit event with `createIn`, so a change without its history is never stored. The GET reads the history with `listByActionPrefix('shipping.us.charge.', market 'US')`. The alternative, a dedicated history table, duplicates the audit log every other setting uses.
5. **Invoice "FREE":** `buildInvoiceDocument` receives the ledger's `shipping_waived`. When true, the shipping row prints `copy.shippingFree` ("FREE" / "GRÁTIS") instead of the amount. Only the row's value changes, so the approved layout holds. The company cost is never printed.
6. **Brazil stays one fee per order.** Who pays extra boxes is left out (decision of 18/11/2026). The BR fee is an on-demand estimate (rate per km × distance) and each delivery is booked one by one on Uber, so a per-box multiplier would price the wrong volume: the weight depends on the pack size (a monthly box of 30 × 300 g is 9.6 kg, of 30 × 500 g is 15.6 kg), and what one ride carries in Curitiba is not confirmed by Uber. A later change quotes Uber with the real weight and boxes and keeps `estimated_shipping_cost` apart from `actual_shipping_cost`.

## Risks / Trade-offs

- [The store shows a stale US price] → The store shows only `original_amount` and `charged_amount` from the API, and the API reports `shipping_total` = what is charged, so a stale screen cannot charge more.
- [Turning charges on does not raise revenue from existing customers] → Intended: it avoids charging shipping that a customer did not accept. Existing subscriptions keep their condition.
- [Sales tax on shipping] → With no shipping line, Stripe Tax computes nothing on shipping. With charges on, it is taxed as before.
- [The invoice prints FREE for a subscription edited by hand in Stripe] → The PDF reads the ledger snapshot. A manual Stripe change is outside the system, as today.

## Migration Plan

1. Migration `1700000000087` adds `charge_shipping` (0) to `shipping_us_settings`. `down` drops it.
2. Deploy the API, then the panel, then the store.
3. Rollback: revert the builds and run `down`. Safe only before the first free US checkout. After it, the previous code ignores `shipping_waived` and, with no positive `shipping_amount_minor`, falls back to the ledger shipping cost, which would charge the quote. So the checkout stores the charged amount (0) as the ledger shipping cost and the quote only in `shipping_original_minor` and `company_cost`, and a rollback after free checkouts needs that checked on the affected rows first.
