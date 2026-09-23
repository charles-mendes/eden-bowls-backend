# Design

## Context

See proposal.md for why delete must be refused. Subscriptions store one `stripe_price_id` column (the first checkout item) and the rest under `plan_selection.catalog_pricing.line_items` (`variation_id`, `stripe_price_id`). Catalog delete today archives Stripe products inside a catch that ignores errors, then deletes posts. Deactivate stays the existing draft update and does not call Stripe.

## Goals / Non-Goals

**Goals:**

- One ledger query per catalog page (or per detail) sets `canDelete` on the products already loaded.
- Delete checks that result before any Stripe call. Archive failure aborts the local delete.

**Non-Goals:**

- A subscription count in the API.
- A new index or a generated column on `plan_selection`.
- Archiving Stripe prices, or changing publish so that it creates a new price.
- Blocking checkout of a draft whose `variation_id` is already stored. That lookup does not read `post_status` today.
- Storefront code.

## Decisions

1. **Match the page’s ids in one query.** Collect variation ids and `price_` values from the products already read, then one `SELECT` against `stripe_subscriptions`: `stripe_price_id IN (...)` plus `JSON_TABLE` on `catalog_pricing.line_items`. Mark `canDelete` in memory. Alternative considered: one query per product. That repeats the JSON scan for every row of a page of up to 100.

2. **The column is not enough.** Checkout and the webhook persist only the first price on `stripe_price_id`. A second pet’s price lives in the JSON. Both must count as a link.

3. **Order on delete: link, then archive, then posts.** 409 returns before `archiveCatalogProduct`. On archive failure of a real `prod_` id, throw 502 and skip `deletePosts`. Remove the empty catch on this path. `prod_seed_*` stays a skip, not an error. Alternative considered: keep deleting locally when Stripe is down. That leaves a sellable Stripe product with no local map, which is the bug this change closes.

4. **Product `canDelete` is the AND of its variations.** Parent delete removes every variation post. Variation delete stays per id.

5. **Boolean only.** Copy in the panel does not show a count, so the payload does not compute one.

## Risks / Trade-offs

- [JSON_TABLE scans the ledger once per catalog page] → Acceptable at current ledger size and page size (default 20, max 100). No index in this change. Revisit only if that page gets slow.
- [Stripe down blocks delete of an unused product] → The operator retries. The posts stay, which is the safe side.

## Migration Plan

No migration. Deploy this API before or with the admin panel change that reads `canDelete`. Rollback restores unconditional delete and the swallowed archive error.

## Open Questions

None.
