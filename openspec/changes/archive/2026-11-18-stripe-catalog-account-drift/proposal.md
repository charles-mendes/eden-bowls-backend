# Proposal

## Why

When an environment's `.env` starts pointing at a different Stripe account, the catalog keeps the `price_` ids of the previous account. The store still lists every product, the "Preços Stripe no catálogo" card on Today still says "Completo … O checkout pode cobrar essas opções", and the first sign of trouble is a customer's checkout failing with `502 stripe_price_retrieve_failed`. That happened on a local database on 2026-11-18: the US key had moved to a new sandbox and all 8 USD prices still belonged to the old account.

The catalog health only checks that each variant has an id that starts with `price_` (`health` in `src/services/admin-catalog.service.js`). It never asks Stripe whether the id exists on the account the API is using. Now that each environment has its own pair of accounts (local, QA and production, Brazil and United States: six accounts), an account swap is a normal event, and it needs a warning before checkout, not at checkout.

## What Changes

- Each catalog sync records the Stripe account id (`acct_…`) of the account it ran against, per market, in `catalog_sync_runs`. This needs a new nullable column (schema migration).
- The catalog health asks Stripe which account the current key belongs to (`accounts.retrieve`, cached in the process) and compares it with the account of the market's last recorded sync. A different account, or a market that was never synced, makes the health report a drift.
- The catalog health also retrieves a small sample of the market's mapped prices on the current account. A missing price makes the health report a drift. This catches a database copied from another environment whose sync record names the right account but whose prices belong to another one.
- The comparison is on the account id, never on the key. Rotating the key on the same account does not warn.
- The "Preços Stripe no catálogo" card on Today shows the drift the same way in local, QA and production: the Stripe account changed, the store still shows the products, checkout will fail, sync the catalog. It links to the screen where the catalog sync runs. While a drift is reported, the card does not say the checkout can charge.
- The health response keeps every field it has today and adds the drift result, so the existing callers keep working.

Out of scope: the same warning on the Coupons screen for first-purchase coupons (`stripe_first_purchase_promos` is also per account). It is a follow-up with its own health endpoint.

## Capabilities

### New Capabilities

- `catalog-stripe-sync`: how the catalog is tied to the Stripe account of each market — what a sync records, how the catalog health verifies the current account and prices, and how the admin panel warns before checkout fails.

### Modified Capabilities

None. `stripe-region-config` keeps choosing the account from the address country; this change only reads which account that is.

## Impact

- API: `src/services/admin-catalog.service.js` (`sync`, `runsFor`, `failedRunsFor`, `health`), `src/infrastructure/repositories/catalog-sync-runs.repository.js`, new migration on `catalog_sync_runs`, `src/infrastructure/db.js`, the Stripe billing client (account lookup). Routes `GET /api/v1/admin/catalog/sync/health` and `GET /api/v1/billing/catalog/sync/health` keep their path and permission (`catalog.read`); their response gains fields. No route is added or removed, so `docs/api-routes.json` does not change.
- Admin panel (`eden-bowls-admin`): `src/components/SystemHealth.tsx` (Today card), `src/components/CatalogPricesSection.tsx` (same health on the products screen), the `SyncHealth` type, and their tests.
- Stripe: two to four read calls per market on a health read (one account lookup per process, plus the sampled `prices.retrieve`), cached for a short time. No object is created by the health.
- Related change: `cutover-stripe-environment-accounts` still describes local and QA sharing one test account. It is updated separately to describe the six accounts and to let local sync its own catalog.
