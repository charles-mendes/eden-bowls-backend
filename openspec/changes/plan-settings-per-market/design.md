# Design

## Context

- `products.repository.findPlanPackaging(country)` picks the first published product of the market (`ORDER BY menu_order, ID LIMIT 1`), reads `_cmpb_plan_days` and `_cmpb_large_pack_limit` from it, and the weights of its active variations only. `onboarding-recommendation.repository` consumes `{ packSizesGrams, planDays, largePackLimit }` and falls back to the old values on `{}`.
- `findProducts` returns `days` per product from `_cmpb_plan_days`. The store does not branch on it, but the field is part of `/api/v1/products`.
- `admin-catalog.service`: `createProduct` requires `planDays` (422 `product_days_not_configured`), `patchProduct` writes `planDays` / `largePackLimit`, publish requires `planCountry` and `planDays` (422 `product_incomplete`).
- Per-market settings already follow one pattern: `company_profiles` (primary key `market`, seeded in the migration, `INSERT IGNORE`), its repository, a service and routes with a `market` query and audit.

## Goals / Non-Goals

**Goals:**
- Market-wide plan values without a product holding them.
- Pack sizes from all products of the market, so `product-is-recipe` can split the catalog.
- No recommendation change on deploy.

**Non-Goals:**
- Changing how the recommendation computes packs.
- Removing the old product metas (they become dead data; `product-is-recipe` deletes the old plan product anyway).
- Store changes.

## Decisions

- **Table `plan_settings`, primary key `market`.** Same shape as `company_profiles`: `market`, `plan_days` (unsigned int, > 0 — the recommendation only accepts integers and falls back to 30 otherwise), `large_pack_limit` (tinyint 1–60), `updated_by`, timestamps. Alternative: a generic key/value settings table. Rejected: two typed columns validate better and match the existing per-market tables.
- **Routes under `/api/v1/admin/catalog/plan-settings`, `catalog.read` / `catalog.write`.** The values are catalog behaviour and the existing spec already ties the limit to `catalog.write`. Putting them under `/admin/settings/*` would need new `settings.*` permissions for the same people.
- **`findPlanPackaging` reads settings + weights of all published products.** Weights: one query joining variation → published parent product with `_cmpb_plan_country = market`, active variations, weight metas. Plan days and limit come from the settings repository injected into `ProductsRepository` (or a new `PlanSettingsRepository` passed to the recommendation repository). Chosen: inject the settings repository into `ProductsRepository`, which already needs it for the store's `days`; `findPlanPackaging` keeps its `{ packSizesGrams, planDays, largePackLimit }` shape, so the recommendation repository does not change. Missing settings record → keep today's fallbacks (30 days, limit 8).
- **`findProducts.days` from settings.** One settings read per request; every product of the market gets the same value.
- **Product API ignores the fields instead of 422.** The panel and the backend ship together, but ignoring avoids breaking an older panel build during the deploy window. Publish check becomes `planCountry` only.
- **Seed in the migration with SQL that mirrors the old `LIMIT 1` read**, so the copied values are exactly what the recommendation used.

## Risks / Trade-offs

- [The store's `days` per product now equals the market value even for a product whose meta differed] → Today the recommendation already uses only the first product's value; there is one product per market, so no visible change.
- [Two products in a market before `product-is-recipe` lands now both contribute weights] → Intended; covered by the new scenario.
- [Admin panel older build still sends `planDays` on create] → Ignored, not refused.

## Migration Plan

1. Migration `1700000000073-create-plan-settings`: create table, seed BR and US with `INSERT IGNORE` from the first published product (fallback 30 / 8).
2. Deploy backend; deploy panel with the new screen.
3. Rollback: `down` drops the table. The product metas were never removed, so the previous code reads them again.
