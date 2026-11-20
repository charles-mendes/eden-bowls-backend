# Spec Delta

## Purpose

Ties the catalog's Stripe prices to the Stripe account each market's key belongs to, so the admin panel warns that checkout will fail before a customer tries to pay with a price from another account.

## ADDED Requirements

### Requirement: A catalog sync records the Stripe account it ran against

Every catalog sync run that completes for a market (`completed` or `completed_with_skips`, market or product scope) MUST store the id (`acct_…`) of the Stripe account whose key the sync used for that market. A failed run MUST NOT store an account id. Runs stored before this change keep no account id.

#### Scenario: US sync on the local sandbox

- **WHEN** an operator syncs the United States catalog and the US key belongs to `acct_LOCALUS`
- **THEN** the stored United States run has `stripe_account_id` `acct_LOCALUS`

#### Scenario: Both markets in one sync

- **WHEN** a sync without a market touches Brazil on `acct_LOCALBR` and the United States on `acct_LOCALUS`
- **THEN** the Brazil run stores `acct_LOCALBR` and the United States run stores `acct_LOCALUS`

#### Scenario: Failed sync

- **WHEN** a sync of the United States fails
- **THEN** the stored failed run has no account id, and it does not count as the market's last sync for the account check

### Requirement: Catalog health reports whether the catalog belongs to the current account

`GET /api/v1/admin/catalog/sync/health` and `GET /api/v1/billing/catalog/sync/health` MUST keep their current fields and add `stripe_account` with `status`, `current_account_id`, `synced_account_id`, `synced_at`, `sampled_prices` and `missing_variation_ids`. `status` MUST be one of `ok`, `account_changed`, `never_synced`, `prices_missing`, `unverified`, `disabled`. Path and permission (`catalog.read`) MUST NOT change.

#### Scenario: Existing caller

- **WHEN** a caller reads the health of the United States
- **THEN** the response still has `market`, `currency`, `totalExpected`, `totalMapped` and `gaps` with the same meaning, plus `stripe_account`

#### Scenario: No secret in the response

- **WHEN** any operator reads the health
- **THEN** the response has account ids and no secret key, publishable key or webhook secret

### Requirement: A different account than the last sync is reported as account_changed

The health MUST compare the account of the current key for the market with the account stored on the market's newest completed sync run. When both ids are known and differ, `status` MUST be `account_changed`. The comparison MUST use the account id only: a new key for the same account MUST NOT change the result.

#### Scenario: Key moved to a new sandbox

- **WHEN** the last United States sync stored `acct_OLD` and the US key now belongs to `acct_NEW`
- **THEN** the United States health has `status` `account_changed`, `synced_account_id` `acct_OLD` and `current_account_id` `acct_NEW`

#### Scenario: Key rotated on the same account

- **WHEN** the last United States sync stored `acct_LOCALUS` and the US key was rotated but still belongs to `acct_LOCALUS`
- **THEN** the United States health is not `account_changed`

### Requirement: A market with products and no completed sync is reported as never_synced

When the market has at least one variant and no completed sync run, `status` MUST be `never_synced`. A market with no variant MUST NOT be reported as `never_synced`.

#### Scenario: Fresh database

- **WHEN** Brazil has 8 variants and `catalog_sync_runs` has no completed Brazil run
- **THEN** the Brazil health has `status` `never_synced`

### Requirement: Prices missing on the current account are reported as prices_missing

The health MUST retrieve a sample of at most three mapped prices of the market from the current account. When Stripe answers that a sampled price does not exist, `status` MUST be `prices_missing` and `missing_variation_ids` MUST list those variants, unless `account_changed` already applies. A run stored without an account id MUST be judged by this sample alone.

#### Scenario: Database copied from another environment

- **WHEN** the last United States sync stored `acct_LOCALUS`, the key belongs to `acct_LOCALUS`, and a sampled price returns "No such price"
- **THEN** the United States health has `status` `prices_missing` and lists that variant in `missing_variation_ids`

#### Scenario: Run from before this change

- **WHEN** the newest completed United States run has no account id and every sampled price exists on the current account
- **THEN** the United States health has `status` `ok` and `synced_account_id` `null`

### Requirement: The account check does not fail the health or alarm on its own errors

When Stripe cannot be reached or answers with an error other than a missing price, `status` MUST be `unverified` and the response MUST still carry the coverage fields with HTTP 200. When Stripe Brazil is disabled, the Brazil `status` MUST be `disabled` and the health MUST NOT call Stripe for Brazil.

#### Scenario: Stripe timeout

- **WHEN** the account lookup times out while an operator reads the United States health
- **THEN** the response is 200 with the coverage fields and `stripe_account.status` `unverified`

#### Scenario: Brazil disabled

- **WHEN** `STRIPE_BR_ENABLED` is `false` and an operator reads the Brazil health
- **THEN** `stripe_account.status` is `disabled` and no Stripe request is made for Brazil

### Requirement: Account checks are cached and reset by a sync

The account id of a key MUST be looked up at most once per market per API process while the lookup succeeds. A price sample result MUST be reused for at most 5 minutes. A completed sync of a market MUST discard that market's cached sample, so the next health read checks again.

#### Scenario: Repeated reads

- **WHEN** an operator opens Today three times within one minute
- **THEN** Stripe receives at most one account lookup and one price sample per market

#### Scenario: Sync clears the warning

- **WHEN** the United States health reports `account_changed` and the operator then completes a United States sync
- **THEN** the next United States health read reports `ok`

### Requirement: Today warns about a catalog on another Stripe account

The "Preços Stripe no catálogo" card on Today MUST show a warning for each market visible to the operator whose `status` is `account_changed`, `never_synced` or `prices_missing`, whichever market the card's selector shows. The text MUST say that the store still shows the products, checkout will fail, and the catalog must be synced. It MUST be the same in local, QA and production.

#### Scenario: Account changed on the United States

- **WHEN** an operator who sees both markets opens Today and the United States health is `account_changed`
- **THEN** the card shows "A conta Stripe dos EUA mudou desde a última sincronização. A loja continua mostrando os produtos, mas o checkout vai falhar. Sincronize o catálogo dos EUA.", even with Brasil selected

#### Scenario: Operator of one market

- **WHEN** an operator scoped to Brazil opens Today and only the United States has a drift
- **THEN** the card shows no United States warning

### Requirement: The warning links to the catalog sync and drops the all-clear

While a market has a warning, the card MUST NOT show the "Completo" badge or the sentence that the checkout can charge for that market. An operator with `catalog.sync` MUST get a link to the screen where the catalog sync runs; an operator without it MUST be told to ask someone with that permission. `unverified` MUST show a neutral note, not a warning.

#### Scenario: Operator who can sync

- **WHEN** an operator with `catalog.sync` sees the United States warning
- **THEN** the card links to the products screen where "Sincronizar catálogo" runs, and the summary does not say the checkout can charge

#### Scenario: Read-only operator

- **WHEN** an operator with `catalog.read` and without `catalog.sync` sees the warning
- **THEN** the card has no sync link and says to ask an operator who can sync the catalog

#### Scenario: Stripe unreachable

- **WHEN** the United States health is `unverified`
- **THEN** the card shows that the Stripe account could not be checked now, without the drift warning

### Requirement: The products screen shows the same warning above the sync

The catalog prices section on the products screen MUST show the same warning for the market it shows, above the "Sincronizar catálogo" action.

#### Scenario: Products screen

- **WHEN** an operator with `catalog.sync` opens the products screen and the selected market is `account_changed`
- **THEN** the section shows the warning above "Sincronizar catálogo"
