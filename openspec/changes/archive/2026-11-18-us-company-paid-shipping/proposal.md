# Proposal

## Why

The client decided on 17/11/2026 (docs-new/FEATURE_MEDIDAS_CAIXAS/decisoes-starter-box.md) that US customers do not pay shipping, on the Starter or on monthly charges: the company pays UPS, and the quote is kept as the company's cost. She then asked for this to be a switch: an admin or a US operator turns US shipping charges on or off in the panel, every change is kept in a history, and while charges are off the store shows the original price struck through and "FREE". The customer's invoice must say the shipping was free. Brazil keeps charging shipping as today: one fee per order, by distance.

## What Changes

- **US charge switch:** a persisted US shipping setting `charge_shipping`, off on deploy (US shipping free, as the client decided). An operator with `shipping.write` on the US market (admin or US operator) turns it on or off. Each change is recorded in the admin audit log, and the shipping settings return the history: when, who, on or off.
- **New checkouts follow the switch.** On: the customer pays the US quote, as today. Off: the customer pays 0. Each subscription keeps for good the condition it was checked out with: later renewals and plan edits never start or stop charging shipping because the switch moved.
- **The quote carries both amounts.** Every US quote response and the stored shipping of a subscription carry `original_amount` (the quote), `charged_amount` and `charge_enabled`, so the store can strike the original and show "FREE" without holding any rule or amount of its own.
- The US quote is always stored with the subscription as the company's cost when it is not charged (`company_cost`, currency, source). The UPS label already stores its quoted and actual cost.
- **Invoice:** the Eden Bowls invoice of a US subscription with free shipping prints "FREE" on the shipping row in place of $0.00. The layout does not change.
- **BR:** shipping is charged as today, one fee per order by distance, whatever the number of boxes, on the Starter and on plans, at checkout and on renewals. The switch does not exist for BR.
- Out of scope: box weights and box choice (change `shipping-boxes-real-weights`), any free-shipping rule for BR, Stripe's own hosted invoice (customers receive the Eden Bowls PDF).
- Out of scope, by decision of 18/11/2026: who pays the extra boxes of a BR order. The BR fee stays one per order. A later change, after the client confirms who pays and Uber confirms what a Curitiba ride carries, quotes Uber with the real weight and boxes and separates `estimated_shipping_cost` from `actual_shipping_cost`.

## Capabilities

### New Capabilities

- `customer-shipping-charge`: what the customer pays for shipping in each market, how a subscription keeps its condition, and what the company records as its cost.
- `customer-invoices`: how the Eden Bowls invoice prints a shipping the company paid.

### Modified Capabilities

- `shipping-settings`: the US charge switch and its history, and the US quote package as a cost quote.
- `stripe-shipping-product`: US renewals follow the subscription's own shipping condition.

## Impact

- New migration `1700000000087`: `shipping_us_settings.charge_shipping` (0).
- Edited: `shipping.service.js` (quote amounts), `onboarding-shipping-select.service.js`, `onboarding-subscription-checkout.service.js`, subscription preview and sales tax quote, `subscriptions-edit-preview.repository.js` and edit commit, `stripe-billing-client.js` (subscription metadata `shipping_original_minor`, `shipping_waived`), `stripe-webhook.service.js` (`invoice.created`), shipping settings entity, repository, normalizer and validator, `admin-shipping.service.js` (audit and history), `src/core/invoice/invoice-document.js` and `invoice-copy.js`, admin subscription presenter.
- No new route: `docs/api-routes.json` does not change.
- Sibling changes `us-company-paid-shipping` in `eden-bowls` (store) and `eden-bowls-admin` (panel). Deploy the API first.
- **Launch blocker outside code:** the published US Terms say the monthly amount includes shipping. A new Terms version must be published before launch, together with the Starter one.
