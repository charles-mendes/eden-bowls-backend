# Proposal

## Why

The plan days and the large-pack limit live as metas on "the market's plan product", and the recommendation reads them, with the pack sizes, from the first published product of the market (`LIMIT 1`). That ties a market-wide setting to one catalog row and blocks the next change (`product-is-recipe`), which splits the catalog into one product per recipe: with several products per market there is no single product to hold these values, and pack sizes from only the first product would drop the weights of the others.

## What Changes

- New per-market plan settings: plan days and large-pack limit, one row per market (BR, US), read and saved by the admin with `catalog.read` / `catalog.write` through `GET/PUT /api/v1/admin/catalog/plan-settings?market=`.
- The deploy seeds each market with the values its plan product holds today (plan days of the first published product of the market, large-pack limit of the same product, 8 when it has none), so recommendations do not change.
- The recommendation reads plan days and the large-pack limit from the market's plan settings, and the pack sizes from the active variations of **every** published product of the market, not only the first one.
- The store catalog (`GET /api/v1/products`) keeps the `days` field of each product, now filled from the market's plan settings.
- **BREAKING** (admin API): the product create and PATCH stop accepting `planDays` and `largePackLimit`; product detail stops returning them. Creating a product no longer requires plan days, and publishing requires only the market. The old metas stay in the database, no longer read.
- Panel (`eden-bowls-admin`): a "Plano" settings screen per market; the "Plano" section leaves the product detail. Specified by the paired change `eden-bowls-admin/openspec/changes/plan-settings-per-market` (`operations/catalog-plan-settings`, `operations/catalog-products`); both are applied and archived together.

## Capabilities

### New Capabilities

- `plan-settings`: per-market plan days and large-pack limit, their admin read and save, validation, permissions, audit and deploy seed.

### Modified Capabilities

- `plan-packaging`: pack sizes come from the active variations of all published products of the market; plan days and large-pack limit come from the market's plan settings instead of the plan product.

## Impact

- Backend: new migration and repository for the settings table; new admin routes; `products.repository` (`findPlanPackaging`, `findProducts`), `onboarding-recommendation.repository`, `admin-catalog.service` / `admin-catalog.repository` (create, PATCH, publish check, product detail).
- API: two new routes (`GET` and `PUT /api/v1/admin/catalog/plan-settings`); `docs/api-routes.json` regenerated. No route removed. `/api/v1/products` response shape unchanged.
- Panel: new settings screen, `ProductDetailPage` loses the plan fields, `npm run contract:sync`.
- Store: no change.
- Tests: plan-packaging / recommendation tests, admin catalog service and routes tests, routes manifest test.
