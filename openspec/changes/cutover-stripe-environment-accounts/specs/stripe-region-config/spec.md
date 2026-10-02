# Spec Delta

## ADDED Requirements

### Requirement: Each environment uses its own merchant account pair

QA and local development MUST use the QA Brazil sandbox and the QA United States test account. Production MUST use the live Brazil account and the live United States account. The retired shared sandbox MUST NOT be the configured account on QA, production, or a developer machine. QA and local development MUST NOT use live secret keys or live webhook signing secrets. Production MUST NOT use the QA test secret keys. Documentation MUST call the Brazil QA account a sandbox. It MUST NOT call that account a restricted key or an `rk_` credential. "Área Restrita" is only Stripe's Portuguese label for a sandbox.

The Stripe dashboards MUST call only these API destinations:

- QA Brazil: `https://qa-api.edenbowls.com/stripe/v1/webhook/br`
- QA United States: `https://qa-api.edenbowls.com/stripe/v1/webhook/us`
- Production Brazil: `https://api.edenbowls.com/stripe/v1/webhook/br`
- Production United States: `https://api.edenbowls.com/stripe/v1/webhook/us`

A local process MUST verify CLI-forwarded events with the signing secret printed by `stripe listen` for that machine and that QA account. That local secret MUST NOT be the dashboard signing secret of the QA or production endpoint. The QA host MUST verify with the QA dashboard signing secrets. The production host MUST verify with the live dashboard signing secrets.

Operator documentation MUST state that the store publishable key for a country and an environment is the publishable key of the same merchant account as that environment's API secret for that country. QA and local store builds use the QA test publishable keys. The production store build uses the live publishable keys.

Secret keys, publishable keys, and webhook signing secrets MUST NOT appear on the HEAD of PR1 or PR2, in documentation at that HEAD, in env templates, or in this change. `.env.example` and `.env.qa.example` MUST keep the regional names and empty values. Commits before PR1 may still contain the retired sandbox account fragment `TObKd` and the placeholder suffixes `US...` and `BR...`. History is not rewritten. The repository is public. Those historical values are unusable after the rotations in tasks 4.2 and 4.3. The ignore path for this change MUST include both `openspec/changes/cutover-stripe-environment-accounts` and `openspec/changes/archive`.

#### Scenario: QA and local are not the retired sandbox

- **WHEN** an operator reads the Stripe setup doc for QA or for localhost
- **THEN** it assigns the QA Brazil sandbox and the QA United States test account, and it does not assign the retired shared sandbox or describe that sandbox as a restricted key

#### Scenario: Production is the live pair

- **WHEN** an operator reads the production Stripe setup
- **THEN** it assigns the live Brazil account and the live United States account, and it does not assign the QA test accounts

#### Scenario: Local signing secret is the CLI secret

- **WHEN** an operator follows the localhost webhook doc
- **THEN** it tells them to put the `stripe listen` signing secret for the QA account of that country into the local env, and it tells them not to paste the QA or production dashboard signing secret there

#### Scenario: PR1 and PR2 do not contain merchant secrets

- **WHEN** the HEAD of PR1 or PR2 is searched for live secret keys, test secret keys, publishable keys of a real account, or webhook signing secrets, excluding this change directory and the archive
- **THEN** there is no match, and every remaining test-key prefix on that HEAD is a synthetic CI placeholder
- **AND** matches in commits before PR1 are historical test material (retired sandbox account fragment `TObKd`, or the placeholder suffixes `US...` and `BR...`), history is not rewritten, and those secrets are unusable after the rotations in tasks 4.2 and 4.3

### Requirement: Stored Stripe ids belong to one merchant account

Checkout MUST keep reading catalog prices from post meta `_stripe_price_id` and `_stripe_price_ids_by_currency`. Those ids, ledger `stripe_customer_id`, `stripe_subscription_id`, and `stripe_price_id`, customer meta `_hsr_stripe_customer_id_br`, `_hsr_stripe_customer_id_us`, and the legacy US fallback `_hsr_stripe_customer_id`, and `coupon_id` / `promotion_code_id` on `stripe_first_purchase_promos` MUST be ids of the merchant account configured for that environment and country. A user MUST be allowed to hold one customer id on the Brazil account and another on the United States account. The API MUST NOT reuse a single customer column for both accounts. The cutover MUST NOT copy a Charles account id onto a QA or live account. Seed values `prod_seed_*` and `price_seed_*` MUST NOT be sent to Stripe as real ids.

Before checkout uses a new account, the catalog and the first-purchase coupons for that account MUST exist on it, and QA rows that still store Charles ids MUST be retired locally so the API does not call the new account with those ids. This cutover MUST NOT add a schema migration.

#### Scenario: Checkout does not send a Charles price to the new account

- **WHEN** QA checkout runs after the host uses the QA secret keys
- **THEN** the price id sent to Stripe exists on that QA account, and it is not a Charles account price id or a `price_seed_` placeholder

#### Scenario: A retired QA subscription is not refreshed on the new account

- **WHEN** a QA ledger row still stores a customer or subscription id from the retired sandbox
- **THEN** the API does not call the new account with that id

### Requirement: Webhook endpoints subscribe to the pinned event list and API version

Each of the four dashboard endpoints MUST subscribe to exactly the events in `src/infrastructure/stripe/stripe-webhook-events.js` and MUST send those events with API version `2025-09-30.clover`. The endpoint MUST NOT use the account's default API version when that default differs, and it MUST NOT use "all events" or a shorter list.

#### Scenario: A new account endpoint matches the SDK pin

- **WHEN** an operator reviews one of the four dashboard endpoints
- **THEN** its event list matches the 28 events in the source list and its API version is `2025-09-30.clover`

### Requirement: Compromised secrets are rotated before a host is configured

The operator MUST rotate both live secret keys and regenerate both production webhook signing secrets, and MUST rotate both QA secret keys and regenerate both QA webhook signing secrets, before those values are written to a host `.env`. Publishable keys MUST NOT be rotated for this exposure. Host cutover MUST use the rotated values. The values from the planning chat MUST NOT be written to a host or to git.

#### Scenario: Host env is written only after rotation

- **WHEN** an operator is about to set `STRIPE_US_SECRET_KEY`, `STRIPE_BR_SECRET_KEY`, `STRIPE_US_WEBHOOK_SECRET`, or `STRIPE_BR_WEBHOOK_SECRET` on QA, production, or a developer machine
- **THEN** the Dashboard secret and the dashboard signing secret for that account have already been rotated, and the value written is the new one

### Requirement: Checkout, currency, and the webhook secret stay on the address country

The API MUST choose the Brazil account when the checkout address country is `BR` and the United States account when it is `US`. Any other country MUST be rejected. The store MUST load `VITE_STRIPE_PUBLISHABLE_KEY_BR` for `BR` and `VITE_STRIPE_PUBLISHABLE_KEY_US` for `US`, using that same address country, not the site domain. When the checkout response includes `stripe_account`, the store MUST abort if it does not match the account whose publishable key was loaded.

A Brazil checkout MUST be charged in BRL. A United States checkout MUST be charged in USD. A Brazil checkout whose catalog currency is missing MUST fail and MUST NOT send `usd` to the Brazil account. `lookupStripePrices` MUST use `_stripe_price_ids_by_currency` for the checkout currency. When that map has no entry for the currency, checkout MUST fail with `unmapped_variant` and MUST NOT send `_stripe_price_id`.

The hourly ledger reconcile reads every `stripe_subscriptions` row by id. No status value skips that read. `stripe_account` stores `br` or `us`, not a merchant account id. QA and local retire MUST delete `stripe_subscriptions` rows with `created_at` before the required cutoff, clear `_hsr_stripe_customer_id_br`, `_hsr_stripe_customer_id_us`, and `_hsr_stripe_customer_id`, and delete matching `subscription_mail_claims` and `ups_shipments` rows. `subscription_production_cycles` follows the ledger through `ON DELETE CASCADE`. The script MUST run only when `EDEN_RUNTIME` is `qa` or `local` and the operator passes `--confirm-delete-ledger` and `--created-before`. It MUST refuse a second run when `background_job_cursors` already has `job_name` `stripe_ledger_retire` with a `cursor` other than `0`. It MUST NOT be a schema migration. A dump of those tables and of the Stripe post meta MUST exist before the script runs. The API MUST refuse to boot when `EDEN_RUNTIME` is missing or is not `local`, `qa`, or `production`. The QA host, each developer machine, and a production API process that is already running MUST have that variable before a build containing the check is deployed. After that build is deployed, an event whose subscription has no `eden_env` MUST NOT be applied. A later cutover after a QA rollback MUST delete `background_job_cursors` where `job_name` is `stripe_ledger_retire` before the retire script runs again. That table is not part of the pre-retire dump. `runLedgerReconcile` reads only `job_name` `ledger_reconcile` and MUST keep doing so.

Catalog sync that creates Stripe products MUST run once, on the QA host, against the QA accounts, and only after that retire. A developer database MUST copy `_stripe_price_id`, `_stripe_price_ids_by_currency`, `_stripe_product_id`, and `_stripe_product_ids_by_currency` by parent `post_name` plus flavor slug and weight, and MUST copy `stripe_first_purchase_promos`. It MUST NOT match on `post_id` alone and MUST NOT run that sync itself. The QA store MUST be stopped from the secret write until that sync finishes.

Checkout MUST set Stripe metadata `eden_env` from `EDEN_RUNTIME` on customer create, subscription create, plan-edit metadata, and the PaymentIntent. The client secret MUST NOT be returned until that PaymentIntent update has finished. If the update fails, checkout MUST fail and MUST NOT return a client secret. `invoice.paid` MUST read `eden_env` from the retrieved subscription and, when that key is absent, from `invoice.subscription_details.metadata`. `invoice.paid` and `customer.subscription.updated` / `deleted` MUST apply only when `eden_env` equals the process `EDEN_RUNTIME`. A missing or different marker MUST be acknowledged with 200, MUST NOT attach a user, and MUST log a warning with the event type, event id, `stripe_account`, and `marker_missing` or `marker_mismatch`. A `payment_intent.succeeded` whose marker is present and different MUST NOT be applied. An empty `EDEN_RUNTIME` MUST NOT match a missing marker. Local user ids and QA user ids are not the same person. `stripe listen` forwards QA events to the laptop, and those events MUST NOT be applied locally.

The retired Charles sandbox MUST have its webhook endpoint removed from `qa-api`, its secret key rolled, and its test subscriptions canceled or the sandbox removed. The pasted Charles secret MUST NOT remain active.

The two live webhook endpoints MUST stay disabled until `api.edenbowls.com` routes both webhook paths and the live signing secrets are loaded in the restarted API. Before those secrets are written, production `stripe_subscriptions` and the three customer meta keys MUST be counted. Either count not equal to zero MUST stop the cutover. A seed price id in the ledger MUST NOT be treated as empty. The production store MUST be stopped before the secrets are written and MUST stay stopped until the live catalog sync finishes. `STRIPE_BR_ENABLED=false` does not stop United States checkout. Live endpoints MUST NOT be enabled before the signing secrets are in the restarted process.

`POST /stripe/v1/webhook/br` MUST verify the signature only with the Brazil webhook signing secret. `POST /stripe/v1/webhook/us` and `POST /stripe/v1/webhook` MUST verify only with the United States webhook signing secret. A signature from the other account MUST be rejected with 400.

Before production, QA MUST complete one Brazil checkout and one United States checkout. Each payment MUST appear on the dashboard of that country's account, the webhook for that account MUST return 200, and the local order status MUST advance. When the same user can check out in both countries, QA MUST do both checkouts with one user.

#### Scenario: Brazil and the United States do not share a publishable key

- **WHEN** a checkout address country is `BR`
- **THEN** the API uses the Brazil secret and the store loads the Brazil publishable key

#### Scenario: A mismatched account aborts the store confirmation

- **WHEN** the store loaded the Brazil publishable key and the checkout response `stripe_account` is `us`
- **THEN** the store does not confirm the payment intent

#### Scenario: Brazil does not fall through to USD

- **WHEN** a Brazil checkout has no catalog currency
- **THEN** the API rejects the checkout and does not create a Stripe subscription in `usd`

#### Scenario: The other account's signature is rejected

- **WHEN** a payload signed with the Brazil webhook secret is posted to `POST /stripe/v1/webhook/us`
- **THEN** the response is 400 and the event is not applied

#### Scenario: A currency missing from the price map does not use the single price field

- **WHEN** a checkout currency has no entry in `_stripe_price_ids_by_currency`
- **THEN** the API does not send `_stripe_price_id` and the variant stays unmapped

#### Scenario: One QA user checks out in both countries

- **WHEN** the same QA user completes checkout with a Brazil address and with a United States address
- **THEN** each payment is on that country's QA Stripe account, each webhook returns 200 on that country's path, and each order status advances in the database

#### Scenario: Canceled status does not stop ledger reconcile

- **WHEN** a ledger row is marked canceled and the hourly reconcile runs
- **THEN** the job still selects that row, so Charles rows are deleted instead of marked

#### Scenario: A local database does not create QA products

- **WHEN** a developer points a local API at the QA secret keys
- **THEN** the local database copies price and product post meta by parent slug, flavor, and weight, copies promo rows, and does not run catalog sync

#### Scenario: The API does not boot without a runtime label

- **WHEN** `EDEN_RUNTIME` is missing or is not `local`, `qa`, or `production`
- **THEN** `parseEnv` throws and the process does not listen

#### Scenario: An ignored invoice is logged

- **WHEN** an `invoice.paid` has no `eden_env` or an `eden_env` that does not equal `EDEN_RUNTIME`
- **THEN** the API responds 200, does not write the ledger, and logs a warning with the event id and `marker_missing` or `marker_mismatch`

#### Scenario: Checkout does not return a client secret before the PaymentIntent is labeled

- **WHEN** the PaymentIntent metadata update fails
- **THEN** the checkout response does not include a client secret

#### Scenario: The retire script does not run because production is unset

- **WHEN** the retire script is invoked with `EDEN_RUNTIME` unset, or set to `production`, or without `--confirm-delete-ledger` and `--created-before`
- **THEN** it exits non-zero and does not delete ledger rows

#### Scenario: Rollback leaves the retire marker

- **WHEN** the pre-retire dump is restored and `background_job_cursors` still has `stripe_ledger_retire`
- **THEN** the retire script stays refused until that row is deleted, and ledger reconcile still reads only `ledger_reconcile`

#### Scenario: A second retire does not delete rows created after the cutoff

- **WHEN** `background_job_cursors` already stores `stripe_ledger_retire`
- **THEN** a second invocation exits non-zero, and rows with `created_at` on or after the recorded cutoff are not deleted by the first run

#### Scenario: QA ignores a local checkout event

- **WHEN** an `invoice.paid` delivered to the QA API has metadata `eden_env` equal to `local`
- **THEN** the API responds 200 and does not attach that subscription to a QA user

#### Scenario: A laptop ignores a QA checkout event

- **WHEN** `stripe listen` delivers an `invoice.paid` whose `eden_env` is `qa` to a process with `EDEN_RUNTIME=local`
- **THEN** the local API responds 200 and does not attach that subscription to a local user

#### Scenario: A payment intent event does not attach a user from metadata

- **WHEN** a `payment_intent.succeeded` carries a `wp_user_id` and an `eden_env` that does not equal the process `EDEN_RUNTIME`
- **THEN** the API does not write a ledger row for that user

#### Scenario: The retired sandbox cannot call QA

- **WHEN** the Charles sandbox cutover is finished
- **THEN** that sandbox has no webhook endpoint aimed at `qa-api`, its pasted secret key is no longer active, and its test subscriptions are canceled or the sandbox is gone

#### Scenario: Live endpoints stay disabled until the host and the signing secret exist

- **WHEN** `api.edenbowls.com` does not yet route the webhook paths, or the live signing secrets are not loaded
- **THEN** both live webhook endpoints are disabled

#### Scenario: Production is counted before secrets are written

- **WHEN** an operator is about to write live secrets and `stripe_subscriptions` or the customer meta keys are not zero
- **THEN** the secrets are not written and the retire script is not run

#### Scenario: Stopping Brazil does not stop the United States store

- **WHEN** production live secrets are written and the live catalog sync has not finished
- **THEN** the production store is stopped, and `STRIPE_BR_ENABLED=false` is not treated as a United States kill switch
