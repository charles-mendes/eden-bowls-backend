# Tasks

## 1. Identity and helper

- [x] 1.1 Add `_eden_admin_markets` load/save next to roles in `admin-users.repository.js` and resolve `markets` plus `market.br`/`market.us` in `AdminIdentityService.resolve` without putting those permissions on `ROLE_PERMISSIONS.operator`. Verify with `npx jest --runTestsByPath tests/admin-roles.test.js tests/admin-me.routes.test.js`.
- [x] 1.2 Create `src/core/admin-market-scope.js` (`canAccessMarket`, `constrainMarketQuery` → 403 `market_forbidden`, `assertRecordMarket` → 404, Stripe account mapping via `stripe-account.js`). Verify with a new `tests/admin-market-scope.test.js`.
- [x] 1.3 Read `ADMIN_ENFORCE_STAFF_MARKET`: flag off scopes assigned staff and leaves unassigned non-admin unscoped; flag on returns 403 `market_required` on query/record. Verify both branches in `tests/admin-me.routes.test.js` and the helper tests.

## 2. Staff assignment

- [x] 2.1 Require `market: BR|US` on `POST /admin/users` and `PATCH /admin/users/:id` when the role is not `admin`; persist meta. Verify invite-without-market is 400 and invite-with-market stamps `/admin/me` via `npx jest --runTestsByPath tests/admin-users-access.routes.test.js tests/admin-users-access.service.test.js`.
- [x] 2.2 Require `market` on `PUT /admin/users/:id/roles` for non-admin targets; skip for `admin`. Preserve last-admin, self-demote, self-delete, and allowlist errors. Verify with `npx jest --runTestsByPath tests/admin-users-roles.routes.test.js tests/admin-users-roles.service.test.js`.

## 3. Canonical write path

- [x] 3.1 Add TypeORM migration `1700000000019` for nullable indexed `onboarding_user_state.market` and register it in `src/infrastructure/db.js`. Verify `down` drops the column and the migration name is listed in db.js.
- [x] 3.2 On first address/checkout persist, if `hsr_market_country` is empty, upsert it; set `onboarding_user_state.market` on state **create** only. Verify a follow-up US address does not change a BR profile market in onboarding/profile tests related to zipcode/address (`npx jest --findRelatedTests src/services/onboarding-zipcode.service.js src/services/profile.service.js`).

## 4. Route guard

- [x] 4.1 Change `buildRequireAdminPermission` to require `{ market: 'none'|'query'|'record' }`, stamp `marketScope` on the middleware, apply `constrainMarketQuery` / `market_required` for query, and pass `adminIdentity` through. Verify missing options throw at registration time.
- [x] 4.2 Annotate every route in `admin.routes.js` and `privacy.routes.js`. Only `/admin/me` and `/admin/me/password` are `none`. Verify with a new stack-walk test that fails if any `/api/v1/admin/*` layer lacks `marketScope`, plus a snapshot of the `none` paths.

## 5. Query and record scoping

- [x] 5.1 Filter `listUsers` with `EXISTS` on `hsr_market_country`; 404 on customer detail/delivery/status/privacy snapshot when the profile market is out of scope; nested subscriptions on customer detail only include in-scope `stripe_account`. Verify with `npx jest --runTestsByPath tests/admin-users.repository.test.js tests/admin-operations.routes.test.js`.
- [x] 5.2 Filter onboarding list/CSV/metrics on `onboarding_user_state.market`; 404 on session detail. Verify with `npx jest --runTestsByPath tests/admin-onboarding.service.test.js`.
- [x] 5.3 Force `stripe_account` on billing list, metrics (SQL COUNT, not `SELECT *`), webhooks, production queue; 404 on subscription/production/shipment/invoice record routes; invoice PDF uses only the row’s account. Verify with `npx jest --runTestsByPath tests/admin-production.routes.test.js tests/admin-production.service.test.js` and the billing/shipping-coupon route tests that cover subscriptions and PDF.
- [x] 5.4 Force catalog `market`, feedbacks `country`, privacy `market`, coupons default account, shipping settings key, and nutrition `country`. Out-of-scope query params return 403 `market_forbidden`. Verify with `npx jest --runTestsByPath tests/admin-catalog.service.test.js tests/admin-feedbacks.routes.test.js tests/admin-nutrition.service.test.js tests/admin-shipping.service.test.js tests/admin-shipping-coupons.routes.test.js` plus privacy admin tests if present (`--findRelatedTests src/services/privacy.service.js`).

## 6. Ledger identity

- [x] 6.1 Remove `wp_users.display_name` from production queue select; present email/name from ledger snapshot; add `customerProfileInScope` on billing and production items. Verify presenter/service tests no longer expect live display_name and the flag is false when profile market differs from `stripe_account`.

## 7. Backfill script

- [x] 7.1 Add `src/scripts/backfill-admin-markets.js` with `--dry-run` counting fillable rows, orphans without country, and profile-vs-`stripe_account` conflicts; apply mode upserts only empty profile/onboarding markets. Verify dry-run prints counts without writes (unit test with a mocked `query`).

## 8. Cross-market record tests

- [x] 8.1 Parametrized Jest: operator BR + US fixture id expects 404 on user, onboarding session, subscription, invoice PDF, production queue patch, product, feedback, privacy request, and shipment record routes. Verify `npx jest --runTestsByPath tests/admin-market-record-scope.routes.test.js`.
