# Design

## Context

See proposal.md for motivation. Admin identity already loads roles from `wp_usermeta._eden_admin_roles` on every request (`AdminIdentityService.resolve`); the JWT carries only `user.id`. Permissions are derived from the role map in `src/core/admin-roles.js` — they are not independently stored. List endpoints use raw SQL (`COUNT` + `LIMIT`) via `dataSource.query`. Several resources already filter in SQL (`stripe_account`, `_cmpb_plan_country`, `feedbacks.country`); customers and privacy requests do not. `hsr_market_country` is read in `profile.repository.js` and never written by Node. Production queue joins `wp_users.display_name`. Invoice PDF can probe both Stripe accounts when `account` is omitted.

## Goals / Non-Goals

**Goals:**

- Same persistence style as roles (usermeta), not a parallel staff table
- Scope at query time in SQL so totals/CSV match the page
- Fail closed on record access (404) and on explicit out-of-scope filters (403)
- Gradual rollout: write path and backfill before forcing `market_required`

**Non-Goals:**

- Replacing `wp_usermeta` or catalog postmeta
- Putting markets in the JWT
- Admin SPA implementation in this repo (contract only: `/admin/me` + `customerProfileInScope`)
- Extra `meta_value` index unless `EXPLAIN` on real volume requires it

## Decisions

### 1. Staff markets live in `_eden_admin_markets`

Store JSON `["BR"]` or `["US"]` next to `_eden_admin_roles`. Derive `market.br` / `market.us` in `resolve`, do not add them to `ROLE_PERMISSIONS.operator` (that would grant BR to every operator).

Alternative considered: `admin_user_markets` table with a DB check constraint. Rejected because users still live in `wp_users` / `wp_usermeta`; a second auth store would diverge from roles.

### 2. `requirePermission(permission, { market })` is the registry

Extend `buildRequireAdminPermission` to require `market: 'none' | 'query' | 'record'` and stamp `marketScope` on the middleware function. `query` runs `constrainMarketQuery` (403 `market_forbidden` if the requested `market`/`account`/`country` is outside `identity.markets`). `record` does not 404 by itself — handlers MUST call `assertRecordMarket` after load.

Alternative considered: a data-driven route table. Rejected as a larger rewrite; the stack walk plus a frozen `none` snapshot is enough to catch undeclared or newly-`none` routes.

### 3. Canonical field per resource, set at write time

Do not resolve `planCountry → address.country → stripe_account` on read. Billing/production keep `stripe_account` as source of truth (already mapped from address country at checkout). Add indexed `onboarding_user_state.market` (migration `1700000000019`). Stamp `hsr_market_country` only when empty (first write). Customer list uses `EXISTS` on that meta, matching `listStaff`.

Alternative considered: one `market` column on every table. Rejected for ledger/catalog that already have a canonical column; dual writes would drift.

### 4. Cross-market invoice uses ledger identity

Stop selecting `wp_users.display_name` in `queueSelectSql`. Present `user.email` from `customer_email` and optional name from `address` JSON. Add `customerProfileInScope` by reading the customer’s profile market (not by joining live display name). Invoice PDF uses `ledgerStripeAccount(item)` only.

### 5. Flag semantics

`ADMIN_ENFORCE_STAFF_MARKET` default false: assigned staff are already scoped; unassigned non-admin stay unscoped; log a warning while any such staff exist. True: unassigned non-admin get 403 `market_required` on `query`/`record`.

### 6. Helper module

`src/core/admin-market-scope.js`: `marketsFromIdentity`, `constrainMarketQuery`, `assertRecordMarket`, `stripeAccountForMarkets`, `canAccessMarket`. Reuse `stripeAccountFromMarket` in `src/core/stripe-account.js`.

## Risks / Trade-offs

- [Route declares `record` but handler forgets `assertRecordMarket`] → Mitigation: parametrized Jest: operator BR + US id → 404 on every `record` route.
- [Backfill before write path] → Mitigation: rollout order in tasks; new checkouts would miss `market`.
- [Customer with BR profile and US subscription] → Mitigation: each record stays in its write market; nested collections filter; `customerProfileInScope` hides the client link; conflict report from the backfill script (admin-only endpoint MAY reuse the same query later; not required for v1).
- [EXISTS on unindexed `meta_value`] → Mitigation: same pattern as `listStaff`; run `EXPLAIN` before adding a prefix index.
- [Operators currently see both markets] → Mitigation: assign markets in UI (sibling admin repo) while the flag is off so the cutover is per-user.

## Migration Plan

1. Ship migration `1700000000019` (`onboarding_user_state.market` nullable + index).
2. Deploy first-write of `hsr_market_country` and create-time `onboarding_user_state.market`.
3. Run `src/scripts/backfill-admin-markets.js --dry-run` (fillable / orphan / profile-vs-stripe conflicts).
4. Apply backfill without `--dry-run`.
5. Admins assign staff markets (admin SPA). Assigned operators become scoped immediately.
6. Set `ADMIN_ENFORCE_STAFF_MARKET=true`.

Rollback: unset the flag (unassigned staff regain access; assigned staff stay scoped). Removing the column/meta is a separate reverse migration and is not required to restore previous visibility for unassigned staff.
