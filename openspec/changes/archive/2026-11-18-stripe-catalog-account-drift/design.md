# Design

## Context

See proposal.md for why.

- `catalog_sync_runs` (migration `1700000000032`) stores one row per market a sync touched: market, currency, scope, product id, status (`completed`, `completed_with_skips`, `failed`), summary, error, start and finish. It has no account column. The repository keeps the newest 50 rows per market and `latestByMarket` returns the newest row of each market, failed ones included.
- `AdminCatalogService.sync` runs `runSync`, then records one run per touched market through `runsFor` / `failedRunsFor`. `runSync` gets the market's Stripe client with `billingFor(country, { forCreation: true })`, which resolves the `br` or `us` account from the market. Brazil throws `stripe_br_disabled` when `STRIPE_BR_ENABLED=false`.
- `AdminCatalogService.health` lists the market's variants and counts those whose `_stripe_price_ids_by_currency[currency]` (or `_stripe_price_id`) starts with `price_`. It makes no Stripe call.
- The panel reads the health in two places: `SystemHealth.tsx` (Today, card "Preços Stripe no catálogo", with a market selector when the operator sees both markets) and `CatalogPricesSection.tsx` (products screen, where "Sincronizar catálogo" posts to `/admin/catalog/sync`). The Today card's "Sincronizar e assinantes" button links to `/billing`, not to the catalog sync.
- A Stripe key is read from the environment at boot. Changing it requires an API restart, so the account behind a key cannot change inside one process.
- Each environment now has its own Brazil and United States accounts (six in total). On 2026-11-18 the local US key belonged to `acct_1UXubcLTXrRah8rp` while all 8 local USD prices belonged to another account.

## Goals / Non-Goals

**Goals:**

- Detect, without creating anything in Stripe, that the catalog of a market does not belong to the account its key points at.
- Keep the health endpoint fast enough to load on every Today visit.
- One message in every environment.

**Non-Goals:**

- Blocking the store or the checkout when a drift is found. The warning is for the operator.
- Running the sync automatically.
- First-purchase coupons (`stripe_first_purchase_promos`). Follow-up.
- Committing any account id or key fingerprint to the repository.

## Decisions

### Record the account id on the sync run, in a new nullable column

Add `stripe_account_id VARCHAR(64) NULL` to `catalog_sync_runs` (next migration number, guarded with `hasColumn`, `down` drops it). `runSync` looks up the account of the market's client once per market the first time it gets the client (`accounts.retrieve()` with no argument returns the key's own account) and keeps it on the market's tally. `runsFor` writes it on completed runs; `failedRunsFor` writes nothing. The repository maps the column to `stripeAccountId`.

Alternatives considered:
- Store it in `summary` JSON. Rejected: the health has to filter by it, and a column reads clearer.
- Store a fingerprint of the key. Rejected: a rotation on the same account would raise a false alarm, and the cutover rotates keys.

### Compare with the newest completed run, not the newest run

`latestByMarket` returns failed runs too. Add a repository read for the newest run with status `completed` or `completed_with_skips` per market. Product-scope runs count: they ran against the same account.

### Health result order

For each market the operator can see, in this order:

1. Brazil with Stripe Brazil disabled → `disabled`, no Stripe call.
2. Account lookup fails (network, auth, any error) → `unverified`.
3. No variant in the market → `ok`.
4. No completed run → `never_synced`.
5. Completed run has an account id and it differs from the current one → `account_changed`.
6. Sample up to three mapped variants (lowest variation ids, stable across reads) with `prices.retrieve`. Any `resource_missing` → `prices_missing` with those variation ids. Any other error → `unverified`.
7. Otherwise `ok`.

`account_changed` skips the sample: every price is from the old account and the extra calls add nothing. Variants with no `price_` id are already reported in `gaps` and are not sampled.

### Caching

- Account id per market: in memory for the process, only after a successful lookup. A key change needs a restart, which clears it.
- Sample result per market: in memory for 5 minutes. A completed sync of the market deletes it.
- The cache lives on the service instance, so `api` and `cron` keep their own. Only `api` serves the health.

Alternative considered: persist the check in the database. Rejected: a restart is when keys change, so a process cache is exactly as fresh as needed.

### Response shape

Keep the current camelCase fields and add one snake_case object, `stripe_account`, as the spec defines. The panel types gain the optional object, so an older API without it still renders the card as today.

### Panel

- Today asks the health for each market the operator can see (both for an admin, one for a scoped operator), not only the selected one, and shows a warning per drifted market above the metrics. The selector keeps choosing which market's numbers are shown.
- `coverage` gets the drift: no "Completo" badge and no "O checkout pode cobrar essas opções" for a drifted market.
- With `catalog.sync`, the warning links to `/catalog/products` ("Sincronizar catálogo"). Without it, it says to ask an operator who can sync the catalog.
- `CatalogPricesSection` shows the same warning text for its market above the sync form. The text lives in one helper shared by both components.

Messages (pt-BR, the panel language):
- `account_changed`: "A conta Stripe {dos EUA|do Brasil} mudou desde a última sincronização. A loja continua mostrando os produtos, mas o checkout vai falhar. Sincronize o catálogo {dos EUA|do Brasil}."
- `never_synced`: "O catálogo {dos EUA|do Brasil} nunca foi sincronizado com esta conta Stripe. A loja continua mostrando os produtos, mas o checkout vai falhar. Sincronize o catálogo {dos EUA|do Brasil}."
- `prices_missing`: "Alguns preços {dos EUA|do Brasil} não existem na conta Stripe atual. A loja continua mostrando os produtos, mas o checkout vai falhar. Sincronize o catálogo {dos EUA|do Brasil}."
- `unverified`: "Não foi possível conferir a conta Stripe {dos EUA|do Brasil} agora."

## Risks / Trade-offs

- [Every environment shows `never_synced` right after deploy if it has no completed run] → Runs from before the deploy still count as completed runs; they just have no account id, so they fall to the sample (step 6). Only a database with no completed run at all warns, which is correct.
- [Fifty failed runs push the last completed run out of the kept rows] → The health then says `never_synced`, and a sync fixes it. Acceptable; the pruning stays as it is.
- [A sample of three misses a missing price elsewhere] → The account comparison covers the swap case. The sample targets copied databases, where every price comes from the same other account, so three is enough. Not a full audit.
- [Stripe rate limits on a busy Today] → At most one account lookup per process and one sample per market per 5 minutes.
- [`accounts.retrieve` permissions on a restricted key] → Secret keys (`sk_`) can read their own account. Restricted keys are not used here (`stripe-region-config`). An error falls to `unverified`.

## Migration Plan

1. Deploy the API with the migration. Existing runs keep `stripe_account_id` null.
2. Deploy the panel. With an API that does not send `stripe_account`, the card stays as today.
3. In each environment, the first sync after deploy stores the account. Rollback: revert the API and panel; the `down` migration drops the column.
