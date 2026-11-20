# Proposal

## Why

On 2026-11-18 local checkout failed twice in a row, each time only at the moment of paying: first the United States shipping quote fell back to the fixed rate with no transit days, then the catalog prices belonged to a different Stripe account. The store showed the products the whole time. Nothing in the panel told the admin, before a customer tried, that checkout for a country was broken. Each environment now has its own Brazil and United States Stripe accounts (six in total), so a key change without a catalog and coupon sync will keep happening.

This change replaces `stripe-catalog-account-drift` (archived on 2026-11-18 without syncing its spec). It keeps that change's catalog-to-account check and moves the warnings out of the Today card into one admin screen that lists everything that would break checkout, per country.

## What Changes

- New admin screen "Checkout da loja", in the Operação group above Hoje, visible and reachable only for the `admin` role. Hoje stays everyone's landing page, the admin's too. Operator and readonly do not see the menu item, and the route sends them back to Hoje.
- The screen lists, in the Pendências format (severity, what the customer would see, a button to the screen that fixes it), only these warnings:
  - Catalog of a market never synced with the current Stripe account, the account changed since the last sync, or a sampled Price (a `price_seed_…` placeholder included) does not exist on the current account. Brazil and United States. Button "Produtos".
  - First-purchase coupon of the 1, 3 or 6 month term not linked on the current account, the stored id no longer exists on it, or it is inactive. Brazil and United States. Button "Cupons de 1ª compra".
  - United States shipping on the fixed rate, UPS without credentials on the server, no ship-from ZIP, or a quote that would fall back to the reserve rate without transit days. United States only. Button "Regras de frete".
  - Brazil distribution center without latitude and longitude. Brazil only. Button "Regras de frete" on the Brazil tab.
  - `STRIPE_BR_ENABLED` off. Brazil only. No button; the text says it is fixed on the server.
  - `STRIPE_BR_SECRET_KEY` or `STRIPE_US_SECRET_KEY` empty. The key's country. No button; the panel only says "ausente".
- A filter Todos / Brasil / EUA, default Todos. Each warning and note carries its country; the filter only hides the other country's warnings and notes. With no warning in the filter the screen says nothing blocks checkout for that country. A warning disappears as soon as that point is right.
- Hoje, for admins only, shows one line "Checkout da loja tem N avisos" with a link to the screen when the Todos count is above zero, and nothing otherwise. The list does not enter Pendências or Saúde do sistema, and the "Preços Stripe no catálogo" card and the products screen's catalog prices section do not repeat it.
- Catalog sync runs store the `acct_…` id of the Stripe account they ran against (new nullable column `stripe_account_id` on `catalog_sync_runs`). `GET /api/v1/admin/catalog/sync/health` and `GET /api/v1/billing/catalog/sync/health` keep their fields and gain `stripe_account` with a status (`ok`, `account_changed`, `never_synced`, `prices_missing`, `unverified`, `disabled`). The account lookup and the price sample are cached, and a sync clears the market's cache. The current health, which accepts any id starting with `price_`, is not what the readiness check reads.
- New admin route `GET /api/v1/admin/checkout/readiness`, admin only. Its response says whether UPS is configured and whether each secret key is present, without any key, secret, `UPS_CLIENT_ID` or `UPS_CLIENT_SECRET` value. The route manifest `docs/api-routes.json` and the panel's `contracts/backend-routes.json` gain the route.

Out of scope: the store's publishable keys (`VITE_STRIPE_PUBLISHABLE_KEY_BR` / `_US`), webhooks, `stripe listen`, `EDEN_RUNTIME`, SMTP, Bling, CPF, consent and incomplete checkout sessions. This change does not sync the catalog or coupons, edit any `.env`, or block checkout.

## Capabilities

### New Capabilities

- `admin-checkout-readiness`: The admin-only list of conditions that would make store checkout fail in Brazil or the United States, the catalog's Stripe account check it relies on, the readiness route, and the Hoje summary line.

### Modified Capabilities

- None. The catalog account fields are added to the existing catalog health response and specified in `admin-checkout-readiness`. No main spec defines that response today.

## Impact

- API (`eden-bowls-backend`): one migration on `catalog_sync_runs`; `catalog-sync-runs.repository.js`; the Stripe billing client (current account id); `admin-catalog.service.js` (sync records the account, health gains `stripe_account`, caches); a new readiness service that reads the catalog check, `stripe-coupon.service.js`, shipping settings, the UPS client and the parsed env; `admin.routes.js`; `docs/api-routes.json`. Permission `system.health.read`, which only `admin` has.
- Panel (`eden-bowls-admin`): `src/lib/menu.ts`, `src/App.tsx`, a new page, `DashboardPage.tsx` (the summary line), `contracts/backend-routes.json`.
- Stripe and UPS read calls only, cached: `accounts.retrieve`, `prices.retrieve`, `promotionCodes.retrieve` and one UPS rate. No write call.
- Store (`eden-bowls`): none.
