# Tasks

## 1. Schema and split migration

- [x] 1.1 Confirm `plan-settings-per-market` is applied (no product reads of `_cmpb_plan_days` / `_cmpb_large_pack_limit`); verify with `rg "_cmpb_plan_days|_cmpb_large_pack_limit" src` showing only migrations.
- [x] 1.2 Migration `…074-add-recipe-content-product`: nullable `product_id` (unique), `flavor_aliases`, `short_label` on `recipe_contents`; verify with a migration unit test (up/down).
- [x] 1.3 Migration `…075-split-plan-products` precheck: abort listing id and SKU for variations without `_recipe_key`, with `_flavor_slug` ≠ `_recipe_key`, or under a product without market; register used but unregistered keys; verify with `tests/split-plan-products.migration.test.js` cases for each refusal and "no change on abort".
- [x] 1.4 Same migration split: product per (market, key) with name, market, `product_cat` and tags, status, `menu_order`; move variations (`post_parent`); `_stripe_lookup_product_id`; content `product_id` / aliases / short label (first variation by `menu_order`, then id); rewrite variation copies incl. life stage from the recipe and log divergences; draft products for content without variations; delete the emptied plan product; `product_id` NOT NULL; `down` restores; verify with the migration test (split, divergent short label / life stage logged and migration completes, recipe without variations, ids kept, rollback) and an integration run with `RUN_DB_INTEGRATION_TESTS=true` on that file.

## 2. Content repository and service by product

- [x] 2.1 `recipe-content.repository`: `findByProductId`, `createForProduct`, `deleteByProductId`, save image / plan image / label / presentation by product id; keep `findByMarketAndSlug(s)` and `listByMarket`; verify with `tests/recipe-content.repository.test.js`.
- [x] 2.2 `recipe-content.service`: image, plan image, label and presentation by product id with the existing validations and in-use checks (active variations of the product); remove `create`, `remove`, recipe list and the `recipe_in_use` path; keep `listPublic` / `getPublic` (active variation of the product with the code, alias fallback); verify with `tests/recipe-content.service.test.js`, `tests/recipes.routes.test.js`, `tests/recipe-energy.service.test.js`.

## 3. Catalog service and repository

- [x] 3.1 `createProduct`: require name, market, code, life stage; write category `flavors`; 409 `product_code_taken`; create content row; verify (including a published admin-created product listed by `GET /api/v1/products`) with `tests/admin-catalog.service.test.js` and `tests/admin-catalog.repository.test.js`.
- [x] 3.2 `patchProduct`: 422 `product_identity_locked` for code/market; rename writes `post_title` and content `name`; name, aliases, life stage, short label rewrite the copies on every variation; audit each change; verify with service tests.
- [x] 3.3 `saveVariants`: ignore flavor and recipe fields, write copies from product content, 422 `variation_weight_taken`; remove `assertRecipeRegistered`, `recipeLifeStage`, `recordRecipeKeyChange`; verify with `tests/admin-catalog.service.test.js` and `tests/admin-catalog-activation.service.test.js`.
- [x] 3.4 `getProduct` / `listProducts`: content once on the product (code, name, life stage, aliases, short label, images, label status, presentation), image and label status per variation, `?code=` filter; activation checks read the product content; verify with service and `tests/admin-catalog-recipe-catalog.repository.test.js`.
- [x] 3.5 Stripe sync lookup key uses `_stripe_lookup_product_id` when present; verify with `tests/admin-catalog-sync-runs.service.test.js` (moved variation keeps its lookup key).
- [x] 3.6 `deleteProduct` deletes the content row and image files after the Stripe archive succeeds; verify with the delete service tests and `tests/integration/catalog-active-subscriptions.integration.test.js`.

## 4. Routes and contract

- [x] 4.1 Remove the `/api/v1/admin/catalog/recipe-content*` routes; add `/api/v1/admin/catalog/products/:productId/content/{image,plan-image,label,presentation}`; verify with a rewritten `tests/admin-recipe-content.routes.test.js` (403 read-only, 404 other market as for the product detail, 404 unknown product).
- [x] 4.2 `npm run routes:manifest`; record every removed route in `docs/api-routes-removed.json`; verify `tests/api-routes-manifest.test.js` and `tests/api-routes-removal.test.js`.

## 5. Other backend readers

- [x] 5.1 `products.repository` flavor lists order by `p.menu_order`, then variation; verify with `tests/products.repository.test.js` and `tests/products.routes.test.js`.
- [x] 5.2 `admin-nutrition.service` / `recipe-energy.service` list recipes from the market's products with content; verify with `tests/admin-nutrition.service.test.js` and `tests/recipe-energy.service.test.js`.

## 6. Panel

- [ ] 6.1 Apply the paired change `eden-bowls-admin/openspec/changes/product-is-recipe` (create dialog, tabs, pack-only variation dialog, recipe screens removed, `contract:sync`); verify its tasks are done before archiving this change.

## 7. Integration check

- [ ] 7.1 Locally: run the migration on a QA copy, check the store plan flavor order, a recommendation, the flavor switch in Editar assinatura, the production queue and a re-sync that creates no Stripe price; run `npx jest --changedSince=main`.
