# Design

## Context

- Catalog: one `product` post per market (`_cmpb_plan_country`, category `flavors` in `product_cat`), variations flavor × weight. Per variation metas: `attribute_pa_flavor`, `_flavor_slug`, `_flavor_aliases`, `_life_stage`, `_short_label`, `_recipe_key`, weight, price, SKU, NCM, Stripe ids.
- `recipe_contents`: `(market, flavor_slug)` unique, columns `name`, `life_stage`, image / plan image, `label` JSON (ingredients as a list), `presentation` JSON. Read by `findByMarketAndSlug(s)` / `listByMarket` from: recipe-content service, admin-catalog service, recipe-energy, production queue names, life-stage emails, invoice copy, public `/api/v1/recipes`.
- Stable flavor identifier for store, production, pack stock, invoices, plan pricing, subscription dashboard: the variation `_flavor_slug` (fallback `canonicalFlavorKey(label)`). `_recipe_key` is read only by content, nutrition and energy.
- `admin-catalog.repository.createProduct` never writes `product_cat`; the store (`listByCategory('flavors')`) only lists products in that category.
- Stripe sync: `lookupKey = eden_${product.id}_${variant.id}_${currency}_${amount}`; `ensureRecurringPrice` reuses a price only by lookup key. Moving a variation to a new product id would create a new price on the next sync, and the variation's stored price ids would stop matching existing subscriptions.
- Delete: `deleteProduct` is blocked by variation use (`canDelete`) and archives Stripe; content images are deleted today only by `recipe-content.service.remove`.
- Requires `plan-settings-per-market` applied first (no plan values on products).

## Goals / Non-Goals

**Goals:**
- Product = recipe: one record to create and edit; uniqueness of code per market and of content per product enforced by the database.
- Zero contract change for the store, production, pack stock, Bling, invoices, subscriptions and the public recipe routes.
- No Stripe price churn and no change of variation ids.

**Non-Goals:**
- Making readers read flavor fields from the parent product (follow-up; variation copies stay).
- Removing `_recipe_key` or unifying it in code beyond equality (follow-up).
- An ingredients table; ingredients stay a list in the label JSON.

## Decisions

- **Keep `recipe_contents`, add `product_id` (bigint unsigned, unique).** Keep `(market, flavor_slug)` unique: the column is the product code. Alternative: move content to `wp_postmeta` — rejected, structured JSON with validation. Alternative: replace the market/slug key by `product_id` — rejected, every reader by market + code would have to change.
- **Add `flavor_aliases` and `short_label` columns to `recipe_contents`.** Product-level fields with the rest of the content; the product post keeps only title, status, market and category. `name` stays and is written together with `post_title` on rename (readers like emails use it).
- **Variation copies written by the service from the product content.** `saveVariants` drops the flavor fields from the payload and writes `attribute_pa_flavor` = product name, `_flavor_slug` = code, `_recipe_key` = code, `_flavor_aliases`, `_life_stage`, `_short_label` from content. Product PATCH of name, aliases, life stage or short label rewrites the copies on all variations (active included — they are derived, not edited; the active-variation lock is for pack fields). Existing `setRecipeLifeStage` already does this for life stage and is generalised.
- **Stable Stripe lookup key.** The migration writes `_stripe_lookup_product_id` = old plan product id on every moved variation; sync uses `variant.lookupProductId || product.id`. Alternative: drop `product.id` from the key — rejected, it changes every key and recreates every price.
- **Product creation writes category `flavors`.** Fixes the gap for admin-created products, needed now that every recipe is a product.
- **Code and market locked: 422 `product_identity_locked`.** Market lock is the user decision; code lock keeps today's "key does not change" rule and the unique index meaningful.
- **Routes.** Remove `/api/v1/admin/catalog/recipe-content` (GET, POST) and `/:flavorSlug` (GET, PATCH, DELETE, image PUT/DELETE, plan-image PUT/DELETE, label PUT, presentation PUT). Add under `/api/v1/admin/catalog/products/:productId/content`: `image` PUT/DELETE, `plan-image` PUT/DELETE, `label` PUT, `presentation` PUT, with `catalog.write` and `market: 'record'`. Name, life stage, aliases and short label go through the existing product PATCH. Product list gains `?code=` so old panel links `/catalog/recipes/:market/:key` can redirect. `/api/v1/recipes*` and `/api/v1/admin/nutrition/recipes` unchanged.
- **Store flavor order.** The migration sets each new product's `menu_order` to the smallest `menu_order` of its variations; `listFlavorOptionsByCountry` / `listFlavorLabelsByCountry` order by `p.menu_order`, then variation.

## Risks / Trade-offs

- [Data the precheck refuses (no key, slug ≠ key via aliases such as `chicken`→`turkey`, product without market)] → Migration aborts listing ids/SKUs; operator fixes in the current admin and reruns. No silent rewrite of `_flavor_slug`.
- [Keys used but never registered] → Migration 044 seeded the puppy and senior variations in both markets without registering the US recipes, so every environment has them. The split registers such a key as migration 040 did (first variation's flavor label and life stage) and logs it, instead of aborting every deploy.
- [Faithful rollback] → The split keeps the plan product posts, metas and terms, each variation's parent and flavor metas, the created products and the registered recipes in `catalog_split_backup`; `down` restores from it and drops it. The table also marks the split as done.
- [Variations of one recipe with different short labels or aliases] → Take the first variation's value (by `menu_order`, then id), log the others, rewrite the copies. [Variation life stage different from `recipe_contents.life_stage`] → The recipe value wins (it already drives `saveVariants` today), the variation meta is rewritten and logged; the store reads the variation meta, so this is the only visible change and it fixes data that was already inconsistent.
- [Old panel build calling removed routes during deploy] → Panel and backend deploy together; QA only (not in production).
- [Product rename now changes the store flavor label of all its variations] → Intended; the registration migration already named recipes after the flavor label, so the deploy itself changes no label.
- [Stripe product per catalog product] → New products from the migration get no product-level Stripe id; sync already uses each variation's own Stripe product.

## Migration Plan

1. Migration `…074-add-recipe-content-product`: add `product_id`, `flavor_aliases`, `short_label` (nullable).
2. Migration `…075-split-plan-products` (transaction):
   a. Precheck; throw with the list on any offending variation.
   b. Per market and recipe key: insert product (title = content name, draft unless any of its variations is active → publish, `_cmpb_plan_country`, `product_cat`/tags of the plan product, `menu_order` = min of variations); `UPDATE wp_posts SET post_parent`; write `_stripe_lookup_product_id`; set `product_id`, aliases and short label on the content row; rewrite the variation copies (flavor label, aliases, short label, life stage) from the content and log each diverging variation.
   c. Content rows without variations → draft product.
   d. Delete the emptied plan product posts and metas.
   e. `product_id` NOT NULL.
3. `down`: move variations back to a recreated plan product per market (the old id stored in `_stripe_lookup_product_id`), delete created products, drop the columns.
4. Deploy backend, then panel.
