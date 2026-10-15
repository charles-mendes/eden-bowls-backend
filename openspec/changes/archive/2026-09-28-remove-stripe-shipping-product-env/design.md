# Design

## Context

See proposal.md. The API is QA-only. `parseEnv` still accepts the three shipping-product variables, and `STRIPE_US_SHIPPING_PRODUCT_ID` falls back to `STRIPE_SHIPPING_PRODUCT_ID`. `createStripeAccountsFromEnv` and `src/index.js` pass those ids into the billing clients and the webhook service.

`ensureShippingProduct()` already creates `Shipping` with `tax_code: txcd_92010001` when the client has no `prod_` id, caches it on that client, and subscription creation writes `shipping_product_id` whenever shipping is greater than zero. `invoice.created` today prefers metadata and then falls back to `runtime.shippingProductId` or the webhook service id, so the same renewal can add shipping or not depending on whether this process already ran a checkout. Subscription edit already keeps an existing metadata id when the client field is empty. `rawEnvSchema` is a Zod object without `.strict()`, so an unknown key is stripped and does not fail boot.

The local `.env` still names the three keys. `.env.example`, `.env.qa.example`, and the docs listed in tasks.md still tell operators to set them. CI, Compose, and `docs/production-go-live.md` do not.

## Goals / Non-Goals

**Goals:**

- Delete the three variables from config, boot wiring, env templates, the local `.env`, and operator docs.
- Keep checkout behavior for subscriptions that store `shipping_product_id`.
- Make the renewal product id metadata-only, and log a warning when a positive amount has no `prod_` id.

**Non-Goals:**

- New resolution in `invoice.created` or in subscription edit when metadata has no product id.
- A metadata-only subscription update.
- Searching Stripe for an existing product named `Shipping`.
- Changing catalog product ids or production secret checks.
- Editing the store or the admin panel.

## Decisions

### Remove the variables and do not replace them

QA checkouts with shipping already persist `shipping_product_id`. Renewals of those subscriptions read that field first, so they do not need the environment. There is no production set of older subscriptions to migrate.

Alternative considered: on a renewal with amount and no product id, create a `Shipping` product and write it back to the subscription. Rejected. That path does not exist today, and this environment has no production subscriptions that depend on it.

### Renewal reads only subscription metadata

`handleInvoiceCreated` uses `metadata.shipping_product_id` and nothing else. Remove the fallback to `runtime.shippingProductId` and `this.shippingProductId`. A cached id from an earlier checkout in the same process must not change the invoice. If the amount is positive and the metadata id is missing or not a `prod_` id, return without adding an item and `logger.warn` with the subscription id and Stripe account. Do not log amounts, customer ids, or payment details. A zero amount stays a quiet no-op.

This is not a new create path. The rejected alternative remains: creating a product during `invoice.created`.

The checkout cache stays. Boot passes no shipping product id. The first checkout with shipping on an account creates the product and later checkouts in that process reuse it. Two checkouts that both see an empty cache can each create a product. A restart can create another one. QA accepts that. Before multiple production replicas, the follow-up is to find or create one shipping product per account, keyed by metadata, instead of the process cache. This change does not do that lookup.

`src/index.js` stops passing `env.STRIPE_US_SHIPPING_PRODUCT_ID` into the webhook service and into the fallback US client. Subscription edit is unchanged. With no env id, an edit does not overwrite `shipping_product_id` unless that process has already resolved one in memory.

### Observed QA subscriptions

On 28 Sep 2026, from this workspace:

- US test account: 19 subscriptions, 14 with `shipping_amount_minor` greater than zero, 0 of those missing `shipping_product_id`.
- Local `stripe_subscriptions`: 5 US rows, all with a positive shipping cost, no BR rows.
- `STRIPE_BR_SECRET_KEY` is unset here, so the BR Stripe account was not listed. The three shipping-product variables are present in `.env` and empty.

That US result supports removal. It is not a substitute for listing BR on the host that has the BR secret.

### Docs and env files

Remove the three lines from `.env.example`, `.env.qa.example`, and the local `.env`. Do not commit `.env`. Update docs that still say to set the keys or that `invoice.created` reads them.

## Risks / Trade-offs

- [A subscription with a positive shipping amount and no `shipping_product_id`] → No shipping line, plus a warning. The US test account had none of these on 28 Sep 2026. BR was not listed from this workspace. No backfill in this change.
- [Restart or two concurrent first checkouts create another `Shipping` product] → Accepted in QA. Known debt before production replicas. Metadata still pins the id each subscription used.
- [The Stripe product previously named by the env var is no longer selected at boot] → Subscriptions that stored that id in metadata still bill it. The product object stays in Stripe.
- [A leftover key in the environment] → Zod strips unknown keys, so boot does not fail. The parsed env must not copy the value. The test covers both an absent key and a present key.

## Migration Plan

1. On each Stripe account whose secret is available, list subscriptions and record any with `shipping_amount_minor` greater than zero and no `prod_` `shipping_product_id`. This workspace already did that for US on 28 Sep 2026 (none). Repeat for BR where `STRIPE_BR_SECRET_KEY` is set. A gap means that subscription's next renewal will have no shipping line. Do not add a backfill in this change; fix or accept that subscription before deleting the keys.
2. Remove the keys from code, templates, docs, and the local `.env`. The repo cannot see a QA host env that is not this file. Deleting those remote lines is an operator step at deploy, not something `rg` can prove.
3. Restart the QA API. Confirm a checkout with shipping stores `shipping_product_id` and that a draft `subscription_cycle` invoice for that subscription adds the shipping item from metadata only.
4. Add the go-live note so production review is not left only in this change. No Compose or CI secret change.

## Open Questions

None.
