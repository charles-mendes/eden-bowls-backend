# Proposal

## Why

Today each market has one plan product whose variations mix every flavor and size, and each variation picks its recipe on its own (`_recipe_key`). Nothing keeps the 300 g and 500 g of the same flavor on the same recipe. Flavor label, slug, aliases, life stage and short label are also repeated on every size, and the store, production, invoices and subscriptions identify the flavor by the variation's `_flavor_slug`, while content, nutrition and energy use `_recipe_key`. The operator manages two screens (product and recipe) for what is one thing. Since each market has its own recipes, nothing is shared that justifies a separate recipe entity: the product is the recipe.

## What Changes

- **BREAKING** catalog model: one product per recipe and market. The product holds the recipe content (name, code, life stage, aliases, short label, image, plan image, label, presentation). Its variations hold only the pack fields (weight, price, SKU, NCM, origin, Stripe ids, readiness flags).
- `recipe_contents` becomes a 1:1 extension of the product: new column `product_id` (unique, required after the migration). The `(market, flavor_slug)` unique index stays, so the product code is unique per market by structure, and every reader that looks content up by market and code keeps working.
- Product code (`flavor_slug`, e.g. `beef`) and market are set on create and cannot change. The code must be unused in the market (409 `product_code_taken`).
- Variations inherit flavor label, slug, aliases, life stage and short label from their product. They are still copied to the variation metas (transition), so store, production, pack stock, Bling, invoices and subscriptions read what they read today.
- A product cannot have two variations with the same weight (422 `variation_weight_taken`).
- Deploy migration splits each market's plan product into one product per recipe, moving the variations (ids kept). It aborts, listing the rows, when a variation has no recipe key, when its flavor slug differs from its recipe key, or when its key is not registered. A registered recipe with no variation becomes a draft product with no variations. The emptied plan product is deleted.
- Stripe price lookup keys of moved variations stay the same, so no new price is created by the move.
- Deleting a product also deletes its content and image files.
- **BREAKING** admin API: the `/api/v1/admin/catalog/recipe-content*` routes are removed; content is read with the product detail and changed under `/api/v1/admin/catalog/products/:productId/content/*`. Variation payloads stop accepting `recipeKey`, `flavor`, `flavorSlug`, `flavorAliases`, `lifeStage` and `shortLabel`.
- Public `/api/v1/recipes` and `/api/v1/recipes/:key` keep their contract. `/api/v1/admin/nutrition/recipes` keeps its contract.
- Panel (`eden-bowls-admin`): one product screen with tabs (general data, content/label, images, presentation, variations); the Receitas list and recipe pages are removed and their links redirect to the product. Specified by the paired change `eden-bowls-admin/openspec/changes/product-is-recipe` (`operations/catalog-products`, `operations/catalog-recipe-content`); both are applied and archived together, after the `plan-settings-per-market` pair.

Depends on `plan-settings-per-market` (plan days and large-pack limit leave the product first).

## Capabilities

### New Capabilities

- `catalog-products`: product = one recipe of one market — create rules (name, code, market, life stage), locked code and market, inherited variation fields, unique weight per product, and the deploy split of the plan products.

### Modified Capabilities

- `recipe-content`: content belongs to a product instead of a registered recipe key; recipe registration, recipe delete, explicit variation key, recipe list and the old backfill requirements are removed; activation, image, label and presentation rules refer to the product's variations.
- `catalog-product-delete`: deleting an unused product also removes its content and image files.

## Impact

- Backend: migration (product split + `product_id`), `admin-catalog.service` / `admin-catalog.repository` (create, detail, variations, delete, Stripe lookup key), `recipe-content.service` / `recipe-content.repository` (by product), `admin.routes.js` (routes removed and added), `products.repository` (flavor ordering by product), `admin-nutrition.service` (recipe list source).
- API: routes removed (registered in `docs/api-routes-removed.json`) and added; `docs/api-routes.json` regenerated.
- Panel: `ProductDetailPage`, `ProductsPage`, removal of `RecipesPage` / `RecipeContentPage`, menu and Reports links, fixtures and mocks, `npm run contract:sync`.
- Store: no contract change; check flavor order and flavor switch locally.
- Out of scope (follow-up): readers reading flavor fields from the parent product and dropping the variation copies; removing `_recipe_key`.
