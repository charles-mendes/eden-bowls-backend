# Tasks

## 1. Plan settings storage

- [ ] 1.1 Add migration `1700000000073-create-plan-settings` (table `plan_settings`, PK `market`, `plan_days`, `large_pack_limit`, `updated_by`, timestamps) seeding BR and US with `INSERT IGNORE` from the first published product of each market (`menu_order`, `ID`), 30 days / limit 8 as fallbacks; verify with a migration unit test covering copy, fallback and "existing row kept", and `down` dropping the table.
- [ ] 1.2 Add `plan-settings.repository.js` (`read(market)`, `save(market, values, actorId)`) following `company-profiles.repository.js`; verify with `tests/plan-settings.repository.test.js`.
- [ ] 1.3 Add `plan-settings.service.js` with validation (`plan_days_invalid` for non-integer or ≤ 0, `large_pack_limit_invalid`), market check and audit of changed values (`catalog.plan_settings.update`, previous/new); verify with `tests/plan-settings.service.test.js`.

## 2. Admin routes

- [ ] 2.1 Register `GET` / `PUT /api/v1/admin/catalog/plan-settings?market=` with `catalog.read` / `catalog.write` and market scope; wire the service in `src/index.js`; verify with `tests/admin-plan-settings.routes.test.js` (200, 400 no market, 403 read-only, 403 outside market, 422).
- [ ] 2.2 Run `npm run routes:manifest`, commit `docs/api-routes.json`; verify `npx jest --runTestsByPath tests/api-routes-manifest.test.js`.

## 3. Recommendation and store read the settings

- [ ] 3.1 Change `findPlanPackaging` to return the weights of the active variations of all published products of the market, and make `onboarding-recommendation.repository` take plan days and limit from the plan settings repository (old fallbacks when absent); verify with `tests/products.repository.test.js`, `tests/onboarding-recommendation.repository.test.js` (new scenario "weight only on a second product") and `tests/simplified-consumption.test.js`.
- [ ] 3.2 Fill `days` in `findProducts` / `listByCategory` from the market's plan settings; verify with `tests/products.repository.test.js` and the products route test.

## 4. Product API stops carrying plan values

- [ ] 4.1 In `admin-catalog.service` / `admin-catalog.repository`: `createProduct` no longer requires or writes `planDays`; `patchProduct` ignores `planDays` and `largePackLimit`; publish requires only `planCountry`; product detail drops `planDays` and `largePackLimit`; verify with `tests/admin-catalog.service.test.js`, `tests/admin-catalog-activation.service.test.js` and `tests/admin-catalog.repository.test.js`.

## 5. Panel

- [ ] 5.1 Apply the paired change `eden-bowls-admin/openspec/changes/plan-settings-per-market` (Plano screen, product page without plan values, `contract:sync`); verify its tasks are done before archiving this change.

## 6. Integration check

- [ ] 6.1 Run `npx jest --changedSince=main` in the backend and the panel's Vitest for the touched pages; locally, confirm a BR recommendation is the same before and after the migration.
