# Design

## Context

See proposal.md for why. What exists today:

- `catalog_sync_runs` (migration `1700000000032`) stores one row per market a sync touched: market, currency, scope, product id, status (`completed`, `completed_with_skips`, `failed`), summary, error, start and finish. It has no account column. `latestByMarket` returns the newest row per market, failed ones included.
- `AdminCatalogService.sync` runs `runSync`, which gets the market's Stripe client through `billingFor(country, { forCreation: true })`. Brazil throws `stripe_br_disabled` when `STRIPE_BR_ENABLED=false`. `AdminCatalogService.health` counts variants whose `_stripe_price_ids_by_currency[currency]` (or `_stripe_price_id`) starts with `price_`, so `price_seed_…` and prices from another account count as mapped. It makes no Stripe call.
- `StripeCouponService.mappingHealth(account)` reads the stored mapping of terms 1, 3 and 6 and reports `complete` from that mapping only. `retrievePromotionCode` already calls `promotionCodes.retrieve` on the account. `syncFirstPurchasePromos(account)` rewrites the mapping.
- `ShippingService.calculateUs` falls back to the fixed rate when `quote_mode` is not `ups`, when `upsClient.isConfigured()` is false (no `UPS_CLIENT_ID` / `UPS_CLIENT_SECRET`), when `us.ship_from.zipcode` is empty, or when the UPS rate fails with a retryable error or `ups_no_rates`. The fixed quote has no transit days in production, and checkout refuses it as `delivery_area_unverified`.
- Brazil shipping refuses with `route_failed` when `br.center.lat` and `br.center.lng` are both `0`.
- Brazil checkout refuses with `catalog_currency_missing` when the plan's `catalog_pricing.currency` is empty (`checkoutCurrency` in `onboarding-subscription-checkout.service.js`). `buildCatalogPricingSnapshot` always fills it from `market.currency` (`BRL`), and no panel or plan setting holds a currency, so only a plan selection stored before the field existed can miss it. That is customer data, not store configuration, so this change has no plan currency warning.
- `system.health.read` is granted only to `admin` (`src/core/admin-roles.js`); `tests/admin-roles.test.js` asserts that. The webhooks health and the market conflicts routes already use it.
- Panel: `src/lib/menu.ts` filters items by `roles`; `App.tsx` has no per-role route guard, pages rely on the API's 403. Hoje is `DashboardPage.tsx`; Pendências is a `ul.day-pending` with `severity`, `title`, `detail`, `to`, `action`. Saúde do sistema (`SystemHealth.tsx`) is an admin-only `<details>`. `ShippingPage` reads `?mercado=br|us` and `?aba=`.
- A Stripe key or UPS credential is read from the environment at boot. Changing one needs an API restart.

## Goals / Non-Goals

**Goals:**

- One admin-only read that answers "would checkout break in Brazil or the United States right now", with no write to Stripe or UPS.
- Fast enough to load on every Hoje visit of an admin.
- The same messages in local, QA and production.

**Non-Goals:**

- Blocking the store or checkout when a warning exists.
- Running a catalog or coupon sync automatically.
- The checks the proposal lists as out of scope (publishable keys, webhooks, `stripe listen`, `EDEN_RUNTIME`, SMTP, Bling, CPF, consent, incomplete sessions).
- Committing any account id, key or fingerprint.

## Decisions

### Record the account id on the sync run, in a new nullable column

Next migration number (after `1700000000088` at the time of writing; use the next free one when applying): add `stripe_account_id VARCHAR(64) NULL` to `catalog_sync_runs`, guarded with `hasColumn`, `down` drops it, registered last in `src/infrastructure/db.js`. `runSync` asks the market's client for its account id the first time it gets the client and keeps it on the market's tally; `runsFor` writes it on completed runs, `failedRunsFor` writes nothing. The repository maps it to `stripeAccountId` and gains `latestCompletedByMarket(markets)` (status `completed` or `completed_with_skips`, market and product scope).

Alternatives: the account in `summary` JSON (rejected, the check filters on it); a key fingerprint (rejected, a rotation on the same account would warn, and the cutover rotates keys).

### The billing client exposes `currentAccountId()`

`StripeBillingClient.currentAccountId()` calls `accounts.retrieve()` with no argument (the key's own account) and memoizes the id on the instance after a success; a failure is not cached. One client instance per account per process, so this is the per-process cache the spec asks for.

### Catalog health keeps its shape and adds `stripe_account`

`health` keeps `market`, `currency`, `totalExpected`, `totalMapped`, `gaps` and adds the snake_case `stripe_account` object, decided in the spec's order. The sample takes up to three mapped variants with the lowest variation ids (stable between reads). A `price_seed_` id is missing without a Stripe call; `resource_missing` from `prices.retrieve` is missing; any other error is `unverified`. `account_changed` skips the sample. The sample result is cached on the service for 5 minutes per market; a completed sync of the market deletes it. The panel's health types gain the optional object; the panel does not render it on the Today card or the products screen.

### One readiness service, one route

New `AdminCheckoutReadinessService` with `read()`, wired in `production-services.js`. It receives the catalog service, the coupon service, the shipping settings and UPS client, and the already-parsed env flags (`stripeBrEnabled`, whether each secret key is non-empty). It never receives or returns a key value.

Route: `GET /api/v1/admin/checkout/readiness` with `requirePermission('system.health.read')`, which only `admin` holds. Reusing that permission avoids a new role entry and keeps the existing admin-roles test meaningful. Then `npm run routes:manifest` and commit `docs/api-routes.json`; in the panel, `npm run contract:sync` and commit `contracts/backend-routes.json`.

Response:

```json
{
  "checked_at": "2026-11-18T12:00:00.000Z",
  "config": {
    "stripe_br_enabled": true,
    "stripe_secret_key_present": { "BR": true, "US": true },
    "ups_configured": true
  },
  "warnings": [
    { "key": "catalog:US", "code": "catalog_prices_missing", "market": "US", "severity": "high", "action": "products", "details": { "missing_variation_ids": [101] } }
  ],
  "notes": [
    { "key": "catalog:BR", "code": "stripe_unverified", "market": "BR" }
  ]
}
```

`code` values: `catalog_never_synced`, `catalog_account_changed`, `catalog_prices_missing`, `coupon_missing` (details: `terms`), `us_shipping_fixed`, `us_ups_not_configured`, `us_ship_from_missing`, `us_ups_quote_fallback`, `br_center_missing`, `stripe_br_disabled`, `stripe_secret_key_missing`. Notes: `stripe_unverified`, `ups_unverified`. `action` values map to panel paths in the panel, so the API does not know panel URLs: `products` → `/catalog/products`, `coupons` → `/billing/coupons`, `shipping_us` → `/config/shipping?mercado=us`, `shipping_br` → `/config/shipping?mercado=br`, `null` for server-side fixes.

Severity: `high` for every warning except `coupon_missing`, which is `medium` because only checkouts with that term are refused.

Alternatives: a new `checkout.readiness.read` permission (rejected: one more grant to keep admin-only, same effect); reusing `GET /api/v1/admin/catalog/sync/health` for everything (rejected: it is `catalog.read`, which operator and readonly have).

### Check order and skips per market

1. Secret key empty → `stripe_secret_key_missing`; skip the catalog and coupon checks of that market.
2. Brazil and `STRIPE_BR_ENABLED` off → `stripe_br_disabled`; skip the Brazil catalog and coupon checks (catalog status `disabled`).
3. Catalog: the health's `stripe_account.status`; `unverified` becomes a note.
4. Coupons: for each term 1, 3, 6, the stored promotion code id must exist, `promotionCodes.retrieve` on the account must not answer `resource_missing`, and the code must not have `active` false (the same refusal as `stripe-billing-client.js`, `invalid_promotion_code_id`). Missing terms are listed in one warning per market. Other Stripe errors become a note. Cached 5 minutes per account; `syncFirstPurchasePromos` and `persistMapping` delete the account's entry.
5. United States shipping, first matching: `quote_mode` not `ups` → `us_shipping_fixed`; UPS not configured → `us_ups_not_configured`; empty ship-from ZIP → `us_ship_from_missing`; otherwise one UPS rate from the ship-from address to itself with `withTransit: true` and the configured package. An error, no rate, or no transit days → `us_ups_quote_fallback`; a timeout or network error → `ups_unverified` note. Cached 5 minutes; saving US shipping settings deletes it.
6. Brazil distribution center: `br.center.lat` and `br.center.lng` both `0` or missing → `br_center_missing`.

### Panel

- `menu.ts`: `{ label: 'Checkout da loja', href: '/operations/checkout-readiness', roles: ['admin'], group: 'Operação' }` placed before Hoje. The `/` redirect stays on `/dashboard`.
- `App.tsx`: the route renders the page only when `hasRole('admin')`; otherwise `<Navigate to="/dashboard" replace />`, before any request.
- The page uses `?pais=todos|br|us` (default `todos`) and the Pendências row markup (`day-pending`, `day-severity-*`, `ghost-button` link). Notes render below the list in muted text, follow the same country filter as the warnings, and are not counted.
- Hoje: for admins, fetch the readiness route once and render one line above Pendências when `warnings.length > 0`. `SystemHealth.tsx` and `CatalogPricesSection.tsx` are not changed.

Messages (pt-BR; `{país}` is "do Brasil" or "dos EUA"):

- `catalog_never_synced`: "O catálogo {país} nunca foi sincronizado com esta conta Stripe. A loja mostra os produtos, mas o pagamento falha."
- `catalog_account_changed`: "A conta Stripe {país} mudou desde a última sincronização do catálogo. A loja mostra os produtos, mas o pagamento falha."
- `catalog_prices_missing`: "Alguns preços {país} não existem na conta Stripe atual. A loja mostra os produtos, mas o pagamento falha."
- `coupon_missing`: "O cupom de 1ª compra de {termos} meses {país} não está vinculado ou está inativo nesta conta Stripe. O checkout desses planos é recusado."
- `us_shipping_fixed`: "O frete dos EUA está em valor fixo. O checkout recusa o endereço por não ter prazo de entrega."
- `us_ups_not_configured`: "A UPS não tem credencial no servidor. O frete dos EUA cai no valor de reserva e o checkout recusa o endereço."
- `us_ship_from_missing`: "Falta o CEP de origem da UPS. O frete dos EUA cai no valor de reserva e o checkout recusa o endereço."
- `us_ups_quote_fallback`: "A cotação da UPS cai no valor de reserva, sem prazo. O checkout dos EUA recusa o endereço."
- `br_center_missing`: "O centro de distribuição do Brasil está sem latitude e longitude. O frete do Brasil não é calculado."
- `stripe_br_disabled`: "A Stripe Brasil está desligada (STRIPE_BR_ENABLED). O checkout do Brasil não abre. Isso se resolve no servidor."
- `stripe_secret_key_missing`: "Chave secreta da Stripe {país}: ausente. O checkout {país} não abre. Isso se resolve no servidor."
- Notes: "Não foi possível conferir a conta Stripe {país} agora." / "Não foi possível consultar a UPS agora."
- Empty: "Nada bloqueia o checkout {do Brasil|dos EUA|da loja}." (`todos` uses "da loja").
- Hoje: "Checkout da loja tem 1 aviso" / "Checkout da loja tem N avisos".

## Risks / Trade-offs

- [Every environment shows `never_synced` right after deploy] → Completed runs from before the deploy still count; without an account id they go to the sample. Only a database with no completed run warns, which is correct.
- [Fifty failed runs push the last completed run out of the kept rows] → The check says `never_synced` and a sync fixes it. Pruning stays.
- [A sample of three misses one bad price elsewhere] → The account comparison covers the swap case; a copied database has every price from the same other account. Not a full audit.
- [The UPS probe rates the ship-from address to itself] → UPS may answer differently for a same-address shipment than for a customer's address. It still exercises credentials, ship-from, package, dry ice switch and transit. A false warning is visible and a real quote in checkout is not affected.
- [Stripe or UPS rate limits] → One account lookup per process and one sample, coupon check and UPS rate per market per 5 minutes, only when an admin opens Hoje or the screen.
- [Hoje gets one more request for admins] → It is read-only and cached; a failed request hides the line instead of breaking Hoje.

## Migration Plan

1. Deploy the API with the migration. Existing runs keep `stripe_account_id` null.
2. Deploy the panel. With an API that does not have the readiness route yet, the Hoje line stays hidden and the screen shows an error.
3. In each environment the first catalog sync after deploy stores the account. Rollback: revert the API and the panel; the `down` migration drops the column.
