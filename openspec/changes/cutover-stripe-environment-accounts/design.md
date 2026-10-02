# Design

## Context

See proposal.md for why the shared sandbox has to go. The API already selects the merchant account from `STRIPE_US_SECRET_KEY`, `STRIPE_US_WEBHOOK_SECRET`, `STRIPE_BR_SECRET_KEY`, and `STRIPE_BR_WEBHOOK_SECRET`, and it already exposes `POST /stripe/v1/webhook/br`, `POST /stripe/v1/webhook/us`, and the US alias `POST /stripe/v1/webhook`. The QA host compose reads the host `.env`. GitHub does not inject Stripe values. Automatic QA deploy is not on `main`. QA already runs with `NODE_ENV=production`, so that flag cannot tell a test key from a live key.

Checkout does not read a product id from the environment. It reads `_stripe_price_id` and `_stripe_price_ids_by_currency` from post meta. The ledger table `stripe_subscriptions` stores `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, and `stripe_account`. User meta stores `_hsr_stripe_customer_id_br` and `_hsr_stripe_customer_id_us`. `stripe_first_purchase_promos` stores `coupon_id` and `promotion_code_id` per `stripe_account`. The flavor seed writes `prod_seed_*` and `price_seed_*`. Those strings are not objects on any Stripe account. Shipping product ids are created at checkout and stored on the subscription, not in env.

## Goals / Non-Goals

**Goals:**

- Move each environment onto the account pair named in the specs, including the catalog and coupon ids that checkout will send.
- Keep every secret out of the repository. Rotate the secrets that were pasted into the planning chat before they are written to a host.
- Make the production webhook test wait on a host this repo does not provision.

**Non-Goals:**

- No new route, no account-id allowlist, and no prefix check (`sk_test_` versus `sk_live_`) inside `parseEnv`.
- No Stripe secrets in GitHub Actions.
- No edit to the store or admin repositories. Their publishable keys are host env plus a rebuild, described from the backend docs.
- No fifth Stripe account for localhost.
- No schema migration and no copy of Charles object ids onto the new accounts.
- This change does not rotate keys in the Dashboard. The operator does that. Publishable keys are not rotated.

## Decisions

### Host env is the binding, not code

The same four variable names hold different values on the QA host, the production host, and a developer machine. Adding a runtime check that the key belongs to a known account would require committing an account id or a key fingerprint, and it would fight the rotation this cutover requires. `NODE_ENV` cannot do the job because QA is already `production`.

Alternative considered: a new `APP_ENV=qa|production|local` guard that rejects `sk_live_` outside production. Rejected. It still cannot tell the retired sandbox from the QA test accounts, and it would fail QA the moment someone sets the guard from `NODE_ENV`. That rejection stands for key prefixes. It does not cover a process label.

`EDEN_RUNTIME` is that label, and it is not in the code, the env templates, or compose today. A denylist of `EDEN_RUNTIME=production` never fires when the variable is unset, which is the production host's current state. The variable is added for two jobs only: the retire script's allowlist, and webhook event routing. It does not inspect Stripe keys. `.env.example` sets `local`, `.env.qa.example` sets `qa`, and the production host sets `production`. Missing, empty, or any other value is not an allowlisted runtime.

### The address country already picks the account

`resolveStripeAccountFromCountry` accepts only `BR` and `US`. The store's `stripeAccountFromCountry` uses the same address: `BR` loads `VITE_STRIPE_PUBLISHABLE_KEY_BR`, anything else loads the US key. Checkout then compares `result.stripe_account` with that choice and aborts on a mismatch. The site domain is not the rule. A missing `stripe_account` on the response is treated as a match today; the checkout service already sets the field on the payloads that carry a client secret, so the QA checkouts have to show the field rather than rely on that hole.

Customers are not one column. `StripeCustomerStore` reads `_hsr_stripe_customer_id_br` or `_hsr_stripe_customer_id_us`. The US read still falls back to `_hsr_stripe_customer_id`. That legacy value is a Charles id after the cutover. `ensureCustomer` already creates a new customer when Stripe says the id is missing, and it creates a new customer when the stored one is in another currency. The retire step still clears the legacy key so the first US checkout does not depend on that recovery. The same user can hold both meta keys.

Currency comes from the catalog market: BRL for Brazil, USD for the United States (`plan-catalog-pricing.js`). `createOnboardingSubscription` still substitutes `usd` when `catalogPricing.currency` is empty. On a Brazil account that becomes a charge in the wrong currency. Brazil without a catalog currency fails instead. The United States may keep USD as the fallback because that is the US account currency.

`registerStripeWebhookRoutes` binds `/webhook/br` to `br` and `/webhook/us` plus the unscoped alias to `us`. The handler verifies with `webhookSecret` for that account only. A Brazil signature on the US path is 400. Each dashboard endpoint still has to be created in the matching Stripe account.

### Call the Brazil QA account a sandbox

Stripe's Portuguese UI labels a sandbox "Área Restrita". That is the same kind of test account as the United States QA account. Docs say "QA Brazil sandbox" so nobody goes looking for an `rk_` key.

### Rotate before any host write

The planning chat included live secret keys and live webhook signing secrets, plus the QA ones. Those values are compromised. The operator rolls both live secret keys and regenerates both production endpoint signing secrets, then does the same for QA, and only then copies the new values into a host `.env`. Publishable keys stay. Local CLI signing secrets are new on each `stripe listen` and are not the dashboard secrets.

### Recreate catalog ids; do not map them

A `price_` from the Charles account returns "No such price" on the QA and live accounts. The same is true for `cus_`, `sub_`, `prod_`, and `coupon_`. The cutover does not keep a translation table.

`stripe_account` is `VARCHAR(8)` and holds `br` or `us` (`stripe-subscription.entity.js`, migration `1700000000014`). It is not a Stripe account id, so the script cannot select Charles rows and leave later rows. On QA and on a developer database, before the new catalog is used, every ledger row is from the retired sandbox or from seed. The script deletes `stripe_subscriptions` rows whose `created_at` is strictly before a required `--created-before` timestamp, and it clears the three customer meta keys. It also deletes `subscription_mail_claims` and `ups_shipments` rows that point at those subscription ids. `subscription_production_cycles.subscription_id` is a foreign key to `stripe_subscriptions.id` with `ON DELETE CASCADE` (`1700000000018`), so those cycle rows go with the ledger and the delete does not fail on that constraint. Mail claims and UPS shipments have no foreign key. `ups_shipments.subscription_id` stores the Stripe subscription id from `mapLedgerToDashboardListItem`, not the ledger primary key. Leaving those rows would keep `sub_` values after the ledger row is gone, so the script deletes them with the ledger.

The script runs only when `EDEN_RUNTIME` is `qa` or `local`, and only with `--confirm-delete-ledger` and `--created-before`. Any other runtime, including unset and `production`, exits non-zero. There is no `wp_options` table. A file written inside the API container does not survive `docker compose up -d --build`: the API service has no writable marker volume, and `./data` is mounted read-only. The second-run record is a row in the existing `background_job_cursors` table (`job_name` `stripe_ledger_retire`, `cursor` the cutoff timestamp, `updated_at` the run time). `cursor` is `varchar(191)`, so the value is the ISO timestamp, not a long document. `get` returns `0` when the row is absent. A second run exits non-zero when the row exists and `cursor` is not `0`. That write is not a schema migration. The MySQL volume keeps the row across an API rebuild. `listAfterId` still has no status filter, so marking `canceled` is not a substitute.

Alternative considered: keep the host-side marker file from the previous revision. Rejected. The retire script runs with `docker compose exec` on the API container, and that container's writable layer is replaced on rebuild.

Order on QA:

1. Stop the QA store. `STRIPE_BR_ENABLED=false` does not stop United States checkout.
2. Write the rotated QA secrets and `EDEN_RUNTIME=qa`. Leave `STRIPE_BR_ENABLED=false`. Restart the API.
3. Dump the Stripe tables and meta named in the tasks.
4. Run the retire script.
5. Sync the catalog once, then recreate first-purchase coupons into `stripe_first_purchase_promos`.
6. Set `STRIPE_BR_ENABLED=true`. Rebuild and start the store only after the QA publishable keys are in the store env.

`seed-flavor-catalog.js` writes `price_seed_*` and `prod_seed_*` into post meta. It does not insert `stripe_subscriptions` or `_hsr_stripe_customer_id*`. `runLedgerReconcile` calls `subscriptions.retrieve` for every row from `listAfterId`. A retrieve error is caught, `failed` is incremented, and the job continues. The error object is discarded, so the row is not marked and the job is not stopped. A fake subscription id would fail on every later pass. Production therefore continues only when `stripe_subscriptions` has zero rows and the three customer meta keys have zero rows. A seed price id in the ledger is not an exception. The retire script is not run on production.

Production order, after that count and after `api.edenbowls.com` answers:

1. Stop the production store.
2. Write the rotated live secrets and `EDEN_RUNTIME=production`. Leave `STRIPE_BR_ENABLED=false`. Restart the API.
3. Enable the two live webhook endpoints.
4. Sync the live catalog and recreate coupons.
5. Set `STRIPE_BR_ENABLED=true`, rebuild the store, start it, and send a signed test event.

Alternative considered: wipe the QA database. Rejected. A wipe drops users and orders that are not Stripe ids. Deleting the Stripe ledger rows before the cutoff and clearing the three customer meta keys is enough.

Alternative considered: delete only rows whose `stripe_account` is Charles. Rejected. The column does not store the merchant account id.

Alternative considered: a new `STRIPE_US_ENABLED` flag. Rejected. Stopping the store covers both countries for the cutover window and for production rollback. A second flag would be a new product switch this cutover does not need.

### Local databases copy QA ids by catalog identity, not by post id alone

Each developer database still has Charles price ids and ledger rows. Running admin catalog sync on each laptop would create another set of products on the shared QA Stripe account. Sync runs once on the QA host.

Post meta is keyed by `post_id`. The flavor seed assigns fixed ids (`FLAVOR_CATALOG` product `100` / `200`, variations from `1001` / `2001` in `seed-flavor-catalog.js`) and does not write `_sku`. An admin-created variation gets the next autoincrement id, so a QA `post_id` and a local `post_id` match only for rows the seed owns on both databases. The copy matches parent `post_name` (`flavors-br` or `flavors-us`) plus the variation flavor slug and weight. It writes `_stripe_price_id`, `_stripe_price_ids_by_currency`, `_stripe_product_id`, and `_stripe_product_ids_by_currency`, and it replaces `stripe_first_purchase_promos`. A local variation with no match is reported and skipped. The operator exports those rows from QA after the QA sync; the file stays out of git. Developers do not open the QA database themselves and do not run catalog sync.

### Events apply only when eden_env matches the process

`resolveUserContext` uses `metadata.wp_user_id` when the ledger and the customer meta miss. Local user 42 and QA user 42 are different people. `src/scripts/stripe-listen.js` forwards every event in the 28-event list, including a checkout that started on QA, so the inverse is the same bug.

Stripe does not copy subscription metadata onto the PaymentIntent or the charge. `handleInvoicePaid` uses `subscription.metadata` when that object exists, and only otherwise `invoice.subscription_details.metadata`. `handleSubscriptionChanged` reads `subscription.metadata`. `handlePaymentIntentUpdate` does not read metadata; it updates checkout state only when the PaymentIntent id is already stored. `handlePaymentFailed` calls `resolveUserContext` without `metadataUserId`. The other events in `stripe-webhook-events.js` are not in `HANDLED_TYPES`, so `handle` acknowledges them and does not resolve a user.

`parseEnv` in `src/config/env.js` is the boot check. `bootstrap` in `src/index.js` calls it before `dataSource.initialize()` and `runMigrations()`. It MUST reject a missing or unknown `EDEN_RUNTIME`. There is no default. An empty value is not equal to a stamped `eden_env`, and a missing marker is not applied, so an unset label would acknowledge every `invoice.paid` with 200 and write nothing. `assertProductionEnv` is the wrong place: it returns immediately when `NODE_ENV` is not `production`, and local boot must fail too. `docker-compose.qa.yml` gives both `api` and `cron` `env_file: .env`. Neither `environment:` block sets `EDEN_RUNTIME`. `api` sets `MODE=http`; `cron` sets `MODE=cron`. Both also set `DB_HOST`, `DB_PORT`, and `UPS_LABEL_DIR`. The image `CMD` is `node src/index.js` for both. `bootstrap` calls `parseEnv`, then `startProcess`. `MODE=cron` does not listen, and it still schedules jobs, including `runLedgerReconcile`, only after `parseEnv` returns. The QA `db` service has no `env_file` and does not call `parseEnv`. `docker-compose.proxy.yml` loads `.env.proxy` into Caddy and does not call `parseEnv`. Local `docker-compose.backend.yml` has only `api`, with `env_file: .env` and `environment:` limited to `UPS_LABEL_DIR`, so `EDEN_RUNTIME=local` in that `.env` reaches the process. Local `docker-compose.yml` is MySQL only. There is no local cron service. `main` has no `deploy.yml`. On `ci/minimal-ci`, `.github/workflows/deploy.yml` runs after a workflow named `ci` succeeds on a push to `main` and rebuilds the QA `api` and `cron` containers. It does not inject `EDEN_RUNTIME`. That workflow is not on `main` today. The next recreate passes the host file into both containers. Current `src/` does not read the name, so the host line can be written before the guard exists. The guard MUST NOT be merged until that QA line is present. After the guard is deployed, Charles subscriptions have no `eden_env`, so `invoice.paid` and subscription changes for them return 200 and are not applied. Merge that code in the cutover window, not weeks earlier. This repo has no production workflow and no production compose. Whether a production API process is already running was not visible from the repository. If one is, it needs `EDEN_RUNTIME=production` before that process is replaced. `.github/workflows/ci.yml` job `config` calls `parseEnv()` with `process.env` and must set `EDEN_RUNTIME=qa`. `tests/env.parse.test.js` passes its own object, so the unit job env does not supply the key. `jest.config.cjs` has no `setupFiles`.

Checkout stamps `eden_env` from `EDEN_RUNTIME` on the customer in `ensureCustomer` (`customers.create`), on the subscription metadata in `createOnboardingSubscription` (`subscriptions.create`), and on the PaymentIntent in `buildOnboardingCheckoutResult` after `loadInvoicePayment` resolves the id. That update is awaited before the method returns the client secret. If it throws, the method throws and the API does not return a client secret. The incomplete subscription stays for the existing reuse path. Returning the secret after a failed stamp would let the store confirm an unlabeled PaymentIntent.

`subscriptions.update` for pause, resume, cancel-at-period-end, and the default payment method does not send `metadata`. `customers.update` during checkout sends address and `invoice_settings` only. `anonymizeCustomer` sends `metadata: { eden_anonymized: '1' }` and does not set `eden_env` to an empty string. The plan-edit path in `subscriptions-edit-commit.repository.js` spreads `subscription.metadata` and then overwrites term fields; it MUST also set `eden_env` from `EDEN_RUNTIME` so the key is present in the object that is sent. The reusable incomplete update sends only `default_payment_method`; when that subscription has no `eden_env`, the reuse path MUST set the key before returning. No seed and no script calls `subscriptions.create`.

`handleInvoicePaid` retrieves the subscription first. It uses `subscription.metadata` when that object is present, and only then `invoice.subscription_details.metadata`. An empty metadata object is truthy, so a subscription with no `eden_env` key does not fall through. The new check reads `eden_env` from the retrieved subscription, and if that key is absent, from `subscription_details.metadata`. If both are empty, it logs `marker_missing` and does not apply the event. A renewal with an empty marker does not update the ledger. The same warning log, with `event.id`, type, `stripe_account`, and `marker_missing` or `marker_mismatch`, covers every ignored handled event. The logger is the pino instance already on `this.logger`.

A handled event that would attach a user is applied only when `eden_env` equals `EDEN_RUNTIME`. A mismatch returns 200 and does not write the ledger. A `payment_intent.succeeded` with a foreign marker is ignored; one with no marker still updates only the checkout row that already stores that PaymentIntent id.

Alternative considered: document the QA-to-laptop direction and leave it. Rejected. `stripe listen` delivers those events, and `invoice.paid` would attach them through `wp_user_id`.

### The Charles sandbox is turned off

Removing it from `.env` does not stop its endpoint or its invoices. The operator deletes the Charles webhook endpoint that targets `qa-api`, rolls the pasted Charles secret, and cancels that sandbox's test subscriptions or removes the sandbox.

### Live endpoints stay off until the host exists

The live endpoints already exist. Any event before `api.edenbowls.com` answers makes Stripe retry and then disable them. They stay disabled until the host answers, the live signing secrets are in the production env, and the API has restarted. Enabling them before the signing secret is written makes every delivery fail verification.

### The single price field is not a cross-account fallback

`lookupStripePrices` uses `_stripe_price_ids_by_currency` for the checkout currency, then `_stripe_price_id` when the map has no entry. That single field holds one price, so a Brazil checkout can send a United States price. Missing currency in the map fails with `unmapped_variant` instead.

### Dashboard endpoints stay on the paths that already exist

Register the four URLs from the spec. Do not add a dashboard endpoint on `POST /stripe/v1/webhook`. That alias remains the US verifier for the cutover. Each endpoint subscribes to the 28 events in `src/infrastructure/stripe/stripe-webhook-events.js` and uses API version `2025-09-30.clover`, the same pin as `STRIPE_API_VERSION` and `DEFAULT_STRIPE_API_VERSION`. A new account's default version is not accepted when it differs. Confirm the event list and the version on all four endpoints after rotation, because regenerating a destination can reset both.

### Production host is an external blocker

`api.edenbowls.com` is not in `infra/caddy/Caddyfile`. This change does not add it. Someone who operates production DNS and the proxy has to make `POST /stripe/v1/webhook/br` and `POST /stripe/v1/webhook/us` reach the production API before the live signed-event check. Until then that check stays blocked. A missing host makes Stripe retry and then disable the endpoint.

### Store publishable keys follow the same account, outside this repo

`VITE_STRIPE_PUBLISHABLE_KEY_BR` and `VITE_STRIPE_PUBLISHABLE_KEY_US` are baked in at the store image build. After the QA or production store `.env` changes, that app is rebuilt. The backend docs say which role each variable takes. They do not contain the key.

### Brazil stays behind the existing flag

`.env.example` and `.env.qa.example` keep `STRIPE_BR_ENABLED=false` so a fresh clone does not call Brazil with an empty secret. A host sets `true` only after the Brazil secret, the Brazil webhook secret, and the Brazil catalog exist on that account.

### Rollback

QA can return to the Charles account only by restoring both the previous `.env` and a dump taken before the retire script runs. That dump covers `stripe_subscriptions`, `subscription_production_cycles`, `subscription_mail_claims`, `ups_shipments`, `stripe_first_purchase_promos`, the Stripe keys on `wp_postmeta`, and the three customer keys on `wp_usermeta`. It does not include `background_job_cursors`. Restoring it leaves `job_name = 'stripe_ledger_retire'`. The only reader of that table is `runLedgerReconcile`, which loads `job_name` `ledger_reconcile` and never lists every row, so the retire row does not move the reconcile cursor. A later cutover deletes that one row by hand, then runs the script again. Restoring the `.env` alone after the catalog sync points checkout at Charles prices that the new meta no longer stores. The dump file stays on the host, outside git.

Production has no previous working Stripe env. If the live cutover fails, keep the production store stopped and set `STRIPE_BR_ENABLED=false`. That flag does not stop United States checkout. Do not invent a Charles rollback for production.

## Risks / Trade-offs

- [Local and QA share the QA test accounts] → A checkout on a laptop creates `cus_` / `sub_` on the QA Stripe account. The dashboard delivers that event to `qa-api`, and `stripe listen` also delivers QA checkouts to the laptop. Mitigation: `eden_env` must equal `EDEN_RUNTIME` before `invoice.paid` or a subscription change is applied. Do not point live keys at a laptop.
- [Pasting the QA dashboard signing secret into a local `.env`] → CLI-signed events return 400. Mitigation: the local doc says to use the secret the CLI prints.
- [Live keys written into a committed file or left in chat] → The live merchant account is exposed. Mitigation: rotate before the host write; docs and templates stay empty; apply does not write `.env`; tracked files and history are searched without printing secret values. The search ignore list includes the archive path so it still works after this change is archived.
- [`api.edenbowls.com` is not in this repo's Caddyfile] → A live webhook test against an unpublished host fails and Stripe can disable the endpoint. Mitigation: both live endpoints stay disabled until the external host answers, and the checklist does not add a Caddy site.
- [Key swap before catalog sync] → Checkout returns "No such price". `STRIPE_BR_ENABLED=false` stops only Brazil. Mitigation: the store stays stopped until sync finishes. A missing customer id is recovered by creating a new customer; a missing price id is not.
- [Each developer runs catalog sync] → The shared QA account gains a duplicate product set per laptop. Mitigation: sync once on QA. Local databases copy the resulting post meta and promo rows, then run the retire script on their own MySQL.
- [Brazil catalog currency empty] → The checkout service would send `usd` to the Brazil account. Mitigation: that path fails instead of substituting USD.
- [US legacy customer meta] → `_hsr_stripe_customer_id` can still point at a Charles customer. Mitigation: the QA retire step clears it along with the two regional keys.
- [Endpoint created with the account default API version] → Payload shape drifts from the SDK pin. Mitigation: each endpoint is checked for `2025-09-30.clover` and the 28 events.
- [`EDEN_RUNTIME` unset] → `invoice.paid` returns 200 and writes nothing. Mitigation: `parseEnv` refuses to boot unless the value is `local`, `qa`, or `production`.
- [Ignored webhook] → A mismatched event looks like success. Mitigation: `logger.warn` records type, event id, account, and `marker_missing` or `marker_mismatch`.
- [Seed id in the production ledger] → `runLedgerReconcile` counts a failed retrieve and continues, without logging the Stripe error. Mitigation: production cutover requires zero ledger rows. The flavor seed does not insert those rows. This change does not edit `runLedgerReconcile`. Follow-up: log the caught Stripe error with the subscription id, `stripe_account`, and the error code, so a revoked key, a subscription deleted in the dashboard, or an invalid id is visible instead of only a `failed` count.
- [Guard started before the host label] → `main` does not rebuild QA on merge. After `ci/minimal-ci` is on `main`, `deploy.yml` rebuilds `api` and `cron` when CI succeeds on `main`. `parseEnv` runs before migrations. A missing `EDEN_RUNTIME` fails the health check and leaves QA down. Mitigation: task 1.5 writes the label while the running code still ignores it, before that process is replaced.
- [Guard merged long before the cutover] → Charles subscriptions have no `eden_env`, so renewals stop updating the ledger. Mitigation: merge the guard in the cutover window.
- [PaymentIntent stamp fails after the subscription exists] → The store could confirm an unlabeled intent. Mitigation: the checkout response waits for the update and does not return a client secret when it fails.

## Migration Plan

1. Update the operator docs and `docs/production-go-live.md`. Do not paste secrets. Write `EDEN_RUNTIME` on the QA host, on developer machines, and on a production API host if one is already running, while `src/` still ignores the name. Only then merge the guard, and merge it in the cutover window. Reject a Brazil checkout that has no catalog currency instead of sending `usd`. Stop the `_stripe_price_id` checkout fallback when the currency map has no entry. `parseEnv` requires `EDEN_RUNTIME`. Stamp `eden_env` on customer create, subscription create, plan-edit metadata, and the PaymentIntent before the client secret is returned. Apply `invoice.paid` and subscription changes only when the marker matches, and log every ignored event.
2. Add `EDEN_RUNTIME` to the empty templates and to the CI `config` job. Search tracked files and history for real key shapes (`sk_live_51`, `sk_test_51`, a long `whsec_`), including the archive path.
3. Operator rotates live and QA secret keys and webhook signing secrets in the Dashboard, and disconnects the Charles sandbox. Publishable keys stay.
4. Operator confirms the four endpoints: 28 events and API version `2025-09-30.clover`. The two live endpoints stay disabled.
5. Operator provisions `api.edenbowls.com` outside this repo. The production signed-event check stays blocked until that is done.
6. On QA, stop the store, write the rotated secrets with `EDEN_RUNTIME=qa`, restart, dump the Stripe tables, run the retire script, sync catalog and coupons once, then set `STRIPE_BR_ENABLED=true`, start the store, and send a signed test event to each QA URL.
7. Rebuild the QA store with the QA publishable keys. Complete one Brazil checkout and one United States checkout with the same user, then one Test Clock renewal. On both invoices, confirm `subscription_details.metadata.eden_env` is `qa`. Pause and resume that subscription and confirm the key is still `qa`. Local databases copy the QA Stripe meta by catalog identity and run the retire script. They do not sync the catalog.
8. On production, after the external host answers and the QA checkouts passed, count ledger rows and customer meta. If either count is not zero, stop. Otherwise stop the store, write the rotated live secrets, restart, enable the live endpoints, sync the live catalog and coupons, set `STRIPE_BR_ENABLED=true`, rebuild and start the store, and send a signed test event.
9. QA rollback restores the previous `.env` and the dump taken before the retire script. To run the retire script again, delete `background_job_cursors` where `job_name` is `stripe_ledger_retire`. Production rollback keeps the store stopped and sets `STRIPE_BR_ENABLED=false`.

## Open Questions

- Developer access to the QA MySQL host is not in this repository. The catalog copy depends on an operator export. If that export cannot be produced, local checkout stays on seed ids and fails against the QA accounts.
- Production ledger and customer-meta counts are not visible from this repo. If either count is not zero, this change does not define a production delete. The retire script refuses `production`.
- Whether a production API process is already running is not visible in this repository. There is no production workflow and no production compose. Task 1.5 covers that host only when the operator knows one is running.
- Stripe metadata merge on pause and resume is checked on the QA dashboard in task 7.6. No update path in the current code sends `eden_env` as an empty string. Pause, resume, cancel-at-period-end, and payment-method updates omit `metadata`. `anonymizeCustomer` sends `{ eden_anonymized: '1' }` and does not clear `eden_env`. Plan edit spreads the existing metadata and the new code also sets `eden_env`.
