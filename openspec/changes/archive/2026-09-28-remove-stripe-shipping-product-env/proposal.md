# Proposal

## Why

The API is still in QA, with no production subscriptions. Checkout already creates a `Shipping` product when no id is configured and stores `shipping_product_id` on the subscription, so the three environment variables are unused configuration.

## What Changes

- **BREAKING** for operators of this QA environment: stop reading `STRIPE_US_SHIPPING_PRODUCT_ID`, `STRIPE_SHIPPING_PRODUCT_ID`, and `STRIPE_BR_SHIPPING_PRODUCT_ID`. Delete them from env templates and from the local `.env`. A leftover value must have no effect.
- Remove the US fallback that copies `STRIPE_SHIPPING_PRODUCT_ID` into the US account, and stop passing a shipping product id from the environment into the Stripe clients or the webhook service.
- Leave checkout and subscription edit otherwise unchanged. Checkout with a positive shipping quote still creates or reuses a `Shipping` product on that Stripe account and writes `shipping_product_id`.
- Make renewal deterministic: the shipping product id comes only from subscription metadata. Ignore any id cached on the process. A positive amount with no `prod_` id adds no shipping line and logs a warning.
- Record that skip on the production go-live checklist. Update the docs that still tell operators to set these variables, and add tests for the spec scenarios, including a leftover env value that must not be exposed.

## Capabilities

### New Capabilities

- `stripe-shipping-product`: Checkout and renewal bill shipping from the product id stored on the subscription, with no shipping product id in the environment.

### Modified Capabilities

- None. Existing specs do not require these variables. Catalog product ids and production secret checks stay as they are.

## Impact

- API only: `src/config/env.js`, `src/index.js`, `src/infrastructure/stripe/stripe-accounts.js`, `src/services/stripe-webhook.service.js`, `.env.example`, `.env.qa.example`, the local `.env`, and `docs/production-go-live.md`.
- Store and admin do not read these variables.
- Renewal does not gain a new way to create a shipping product. It stops using the process cache as a fallback. On 28 Sep 2026 the US test account had 14 subscriptions with a positive `shipping_amount_minor`, and all 14 already had `shipping_product_id`. The BR secret is not in this workspace `.env`, so that account still has to be listed where the BR key exists.
