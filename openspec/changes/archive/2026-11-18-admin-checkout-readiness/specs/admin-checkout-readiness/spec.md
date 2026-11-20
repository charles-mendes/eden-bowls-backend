# Spec Delta

## Purpose

Tells the admin, before a customer tries to pay, every condition that would make store checkout fail in Brazil or in the United States, including a catalog whose Stripe prices belong to another Stripe account, and links each one to the panel screen that fixes it.

## ADDED Requirements

### Requirement: A catalog sync records the Stripe account it ran against

Every catalog sync run that completes for a market (`completed` or `completed_with_skips`, market or product scope) MUST store the id (`acct_…`) of the Stripe account whose key the sync used for that market. A failed run MUST NOT store an account id. Runs stored before this change keep no account id.

#### Scenario: US sync on the local sandbox

- **WHEN** an admin syncs the United States catalog and the US key belongs to `acct_LOCALUS`
- **THEN** the stored United States run has `stripe_account_id` `acct_LOCALUS`

#### Scenario: Both markets in one sync

- **WHEN** a sync without a market touches Brazil on `acct_LOCALBR` and the United States on `acct_LOCALUS`
- **THEN** the Brazil run stores `acct_LOCALBR` and the United States run stores `acct_LOCALUS`

#### Scenario: Failed sync

- **WHEN** a sync of the United States fails
- **THEN** the stored failed run has no account id, and it does not count as the market's last sync for the account check

### Requirement: Catalog health reports whether the catalog belongs to the current account

`GET /api/v1/admin/catalog/sync/health` and `GET /api/v1/billing/catalog/sync/health` MUST keep their current fields, path and permission (`catalog.read`) and add `stripe_account` with `status`, `current_account_id`, `synced_account_id`, `synced_at`, `sampled_prices` and `missing_variation_ids`. `status` MUST be one of `ok`, `account_changed`, `never_synced`, `prices_missing`, `unverified`, `disabled`. The response MUST NOT contain a secret key, publishable key or webhook secret.

#### Scenario: Existing caller

- **WHEN** a caller reads the health of the United States
- **THEN** the response still has `market`, `currency`, `totalExpected`, `totalMapped` and `gaps` with the same meaning, plus `stripe_account`

#### Scenario: No secret in the health

- **WHEN** any operator with `catalog.read` reads the health
- **THEN** the response carries account ids only, and no value starting with `sk_`, `rk_`, `pk_` or `whsec_`

### Requirement: The account status follows a fixed order

For each market the status MUST be decided in this order:

1. Brazil with Stripe Brazil disabled → `disabled`, with no Stripe request for Brazil.
2. The market's secret key is empty, or the lookup of the key's account fails → `unverified`.
3. The market has no variant → `ok`.
4. The market has no completed sync run → `never_synced`.
5. The newest completed run stored an account id that differs from the key's current account → `account_changed`.
6. A sample of at most three mapped prices of the market is checked on the current account. A sampled id that Stripe reports as missing, or a `price_seed_…` placeholder, → `prices_missing`, listing those variants in `missing_variation_ids`. Any other Stripe error → `unverified`.
7. Otherwise `ok`.

The comparison MUST use the account id only: a new key for the same account MUST NOT change the result. A run stored without an account id MUST be judged by the sample alone.

#### Scenario: Key moved to a new sandbox

- **WHEN** the last United States sync stored `acct_OLD` and the US key now belongs to `acct_NEW`
- **THEN** the United States status is `account_changed`, with `synced_account_id` `acct_OLD` and `current_account_id` `acct_NEW`

#### Scenario: Key rotated on the same account

- **WHEN** the last United States sync stored `acct_LOCALUS` and the US key was rotated but still belongs to `acct_LOCALUS`
- **THEN** the United States status is not `account_changed`

#### Scenario: Fresh database

- **WHEN** Brazil has 8 variants and no completed Brazil sync run exists
- **THEN** the Brazil status is `never_synced`

#### Scenario: Database copied from another environment

- **WHEN** the newest completed United States run stored `acct_LOCALUS`, the key belongs to `acct_LOCALUS`, and a sampled price returns "No such price"
- **THEN** the United States status is `prices_missing` and lists that variant in `missing_variation_ids`

#### Scenario: Seed placeholder

- **WHEN** a sampled United States variant stores `price_seed_us_1`
- **THEN** the United States status is `prices_missing` and that variant is listed, without a Stripe request for that id

#### Scenario: Stripe timeout

- **WHEN** the account lookup times out
- **THEN** the health is still HTTP 200 with the coverage fields and `stripe_account.status` `unverified`

### Requirement: Stripe and UPS checks are cached and reset by a sync

The account id of a key MUST be looked up at most once per market per API process while the lookup succeeds. The price sample, the coupon check and the UPS quote check MUST each be reused for at most 5 minutes per market. A completed catalog sync of a market MUST discard that market's price sample, and a completed first-purchase coupon sync of an account MUST discard that account's coupon check, so the next read checks again.

#### Scenario: Repeated reads

- **WHEN** an admin opens Hoje and the readiness screen three times within one minute
- **THEN** Stripe receives at most one account lookup, one price sample and one coupon check per market, and UPS at most one rate request

#### Scenario: Sync clears the warning

- **WHEN** the United States status is `account_changed` and the admin then completes a United States catalog sync
- **THEN** the next readiness read has no United States catalog warning

### Requirement: The readiness route is admin only and carries no secret

`GET /api/v1/admin/checkout/readiness` MUST answer only to a session with the `admin` role, and MUST answer 403 to operator, readonly and veterinarian. The response MUST cover Brazil and the United States in one call, whatever market the admin works in. It MUST state whether UPS is configured and whether each Stripe secret key is present as booleans, and MUST NOT contain any key, secret or credential value: no value starting with `sk_`, `rk_`, `pk_` or `whsec_`, and not the values of `UPS_CLIENT_ID` or `UPS_CLIENT_SECRET`. The route MUST be listed in `docs/api-routes.json`.

#### Scenario: Operator

- **WHEN** an operator calls the readiness route
- **THEN** the API answers 403

#### Scenario: Admin with UPS configured

- **WHEN** an admin calls the route and UPS has a client id and secret on the server
- **THEN** the response says UPS is configured and contains neither value

### Requirement: The readiness list contains only the defined warnings

Each warning MUST carry its country (`BR` or `US`), a severity, what the customer would see at checkout, and the panel action that fixes it. The list MUST contain only these warnings:

| Warning | Country | Condition | Action |
| --- | --- | --- | --- |
| Catalog | BR and US | account status `never_synced`, `account_changed` or `prices_missing` | "Produtos" |
| First-purchase coupon | BR and US | the 1, 3 or 6 month term has no promotion code on the current account, or the stored promotion code does not exist on it, or it exists with `active` false (checkout refuses it as `invalid_promotion_code_id`) | "Cupons de 1ª compra" |
| US shipping | US | quote mode is fixed, UPS has no credentials on the server, the ship-from ZIP is empty, or a UPS quote from the ship-from address falls back to the reserve rate or returns no transit days | "Regras de frete" |
| Distribution center | BR | the Brazil distribution center has no latitude and longitude | "Regras de frete", Brazil tab |
| Stripe Brazil disabled | BR | `STRIPE_BR_ENABLED` is off | none; the text says it is fixed on the server |
| Secret key missing | the key's country | `STRIPE_BR_SECRET_KEY` or `STRIPE_US_SECRET_KEY` is empty | none; the text says "ausente" |

The coupon check MUST NOT rely on the stored mapping's `complete` flag alone. A market whose secret key is missing, and Brazil while Stripe Brazil is disabled, MUST NOT get catalog or coupon warnings for that market. An `unverified` result (Stripe or UPS unreachable) MUST be shown as a neutral note, MUST NOT count as a warning, and MUST NOT be reported as broken checkout.

#### Scenario: Copied catalog

- **WHEN** the United States catalog status is `prices_missing`
- **THEN** the list has a United States catalog warning with the action "Produtos"

#### Scenario: Coupon deleted in Stripe

- **WHEN** the stored Brazil mapping is complete but the 3 month promotion code no longer exists on the Brazil account
- **THEN** the list has a Brazil first-purchase coupon warning for the 3 month term

#### Scenario: Coupon deactivated in Stripe

- **WHEN** the stored United States 6 month promotion code exists but is inactive
- **THEN** the list has a United States first-purchase coupon warning for the 6 month term

#### Scenario: Brazil disabled

- **WHEN** `STRIPE_BR_ENABLED` is off
- **THEN** the list has the Brazil disabled warning without an action, and no Brazil catalog or coupon warning

#### Scenario: Missing US key

- **WHEN** `STRIPE_US_SECRET_KEY` is empty
- **THEN** the list has a United States warning saying the key is "ausente", with no action and no key text

#### Scenario: Stripe unreachable

- **WHEN** the United States price sample fails with a network error
- **THEN** the screen shows a neutral note that the United States Stripe account could not be checked now, and the warning count does not include it

#### Scenario: Out-of-scope condition

- **WHEN** the store's publishable key, a webhook, SMTP or Bling is misconfigured
- **THEN** the readiness list shows nothing for it

### Requirement: The readiness screen is admin only

The panel MUST show the menu item "Checkout da loja" in the Operação group, above Hoje, only to the `admin` role. Operator and readonly MUST NOT see the item, and opening the screen's address MUST send them to Hoje. Hoje MUST stay the landing page for every role, including admin.

#### Scenario: Admin menu

- **WHEN** an admin opens the panel
- **THEN** the panel lands on Hoje, and the Operação group shows "Checkout da loja" above "Hoje"

#### Scenario: Readonly opens the address

- **WHEN** a readonly user opens the readiness screen's address directly
- **THEN** the panel shows Hoje and does not call the readiness route

### Requirement: The screen filters by country and lists warnings like Pendências

The screen MUST offer the filter Todos, Brasil, EUA, with Todos as the default. The filter MUST only hide the warnings and the notes of the other country; notes follow the same filter as warnings. Each row MUST show the severity, what the customer would see, and a button to the screen that fixes it when the warning has an action. A row MUST disappear once its condition is right. With no warning in the selected filter, the screen MUST say that nothing blocks checkout for that country.

#### Scenario: Filter Brasil

- **WHEN** there are a United States shipping warning and a Brazil coupon warning and the admin selects Brasil
- **THEN** only the Brazil coupon warning is shown

#### Scenario: Note follows the filter

- **WHEN** the United States has the note that UPS could not be checked now and the admin selects Brasil
- **THEN** that note is not shown

#### Scenario: No warning for EUA

- **WHEN** the admin selects EUA and no United States warning exists
- **THEN** the screen says that nothing blocks checkout in the United States

#### Scenario: Fixed condition

- **WHEN** the admin fills the Brazil distribution center coordinates and opens the screen again
- **THEN** the distribution center warning is gone

### Requirement: Hoje shows a single summary line for admins

Hoje MUST show, only to the `admin` role and only when the Todos filter has at least one warning, the line "Checkout da loja tem N avisos" with a link to the readiness screen. Notes MUST NOT count. With no warning the line MUST NOT appear. The warnings MUST NOT be listed in Pendências or in Saúde do sistema, and MUST NOT be repeated in the "Preços Stripe no catálogo" card or in the products screen's catalog prices section.

#### Scenario: Admin with warnings

- **WHEN** an admin opens Hoje and the readiness list has 3 warnings across both countries
- **THEN** Hoje shows "Checkout da loja tem 3 avisos" linking to the readiness screen, and Pendências has no checkout readiness row

#### Scenario: Operator

- **WHEN** an operator opens Hoje while warnings exist
- **THEN** Hoje shows no readiness line and does not call the readiness route

#### Scenario: Nothing to fix

- **WHEN** an admin opens Hoje and the list has no warning
- **THEN** Hoje shows no readiness line
