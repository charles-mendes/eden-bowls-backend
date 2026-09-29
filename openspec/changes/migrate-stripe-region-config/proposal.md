# Proposal

## Why

The Node API already has separate Stripe accounts for the United States and Brazil, but `parseEnv` still copies the old single-account variables into the US account. An environment that sets only `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` silently operates the US merchant account, including a production boot. That alias is live code, not leftover documentation, and it hides which credential an operator actually configured.

## What Changes

- **BREAKING** for any host that still relies on the alias: stop reading `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. A leftover value MUST NOT populate `STRIPE_US_SECRET_KEY` or `STRIPE_US_WEBHOOK_SECRET`, MUST NOT satisfy the production secret check, and MUST NOT be copied onto the resolved env object.
- Keep the current regional contract: `STRIPE_US_SECRET_KEY`, `STRIPE_US_WEBHOOK_SECRET`, `STRIPE_US_AUTOMATIC_TAX`, `STRIPE_BR_SECRET_KEY`, `STRIPE_BR_WEBHOOK_SECRET`, and `STRIPE_BR_ENABLED`.
- Keep `STRIPE_API_VERSION` and `STRIPE_MAX_RETRIES` as one shared SDK setting for both accounts. They are not a second copy of the old secret model, and they are not duplicated per country.
- Point missing-secret errors at the regional variable for the account in use. Keep the existing error codes (`stripe_secret_missing`, `stripe_webhook_secret_missing`, `stripe_br_not_configured`, `stripe_br_disabled`).
- Update env templates, the local `.env` (do not commit it), the production go-live checklist, and the operator docs that still describe the alias as supported. Leave WordPress/PHP migration notes that describe the old plugin as historical.
- The store and the admin panel do not read these four backend variables. `VITE_STRIPE_US_AUTOMATIC_TAX` stays a storefront preview flag.

## Evidence

Searched `eden-bowls-backend` for the four old names and the `STRIPE_US_*` / `STRIPE_BR_*` names, then the store and admin trees. Runtime behavior below is from `src/`, not from docs.

### `STRIPE_SECRET_KEY`

Functional. `src/config/env.js` keeps it on the schema and on the resolved object, and uses it as the second argument of `firstNonEmpty(rawEnv.STRIPE_US_SECRET_KEY, rawEnv.STRIPE_SECRET_KEY)`. Production boot checks the resolved US secret, so the legacy key alone can pass `requireProductionSecret('STRIPE_US_SECRET_KEY', ...)`. Checkout, preview, and the billing client then use `env.STRIPE_US_SECRET_KEY`. Nothing after `parseEnv` reads `env.STRIPE_SECRET_KEY` itself.

Also present as the US missing-secret sentence (`STRIPE_SECRET_KEY is not configured.`) in `stripe-accounts.js`, `stripe-billing-client.js`, `onboarding-subscription-checkout.service.js`, and `onboarding-subscription-preview.repository.js`, and as a log redact path in `src/core/logger.js`.

### `STRIPE_WEBHOOK_SECRET`

Functional, same shape. `parseEnv` sets `STRIPE_US_WEBHOOK_SECRET` from `firstNonEmpty(rawEnv.STRIPE_US_WEBHOOK_SECRET, rawEnv.STRIPE_WEBHOOK_SECRET)`. The webhook service asks `stripeAccounts.webhookSecret(account)`, which was filled from the resolved US secret. `POST /stripe/v1/webhook` and `POST /stripe/v1/webhook/us` both use that US secret. Brazil has no legacy alias.

The 503 sentence is still `STRIPE_WEBHOOK_SECRET is not configured.` in `stripe-webhook.service.js` and `stripe-billing-client.js`. The logger redacts the name.

### `STRIPE_API_VERSION`

Functional and global. `parseEnv` defaults it to `2025-09-30.clover`. `createStripeAccountsFromEnv` passes that one value as `apiVersion` to both the US and the BR `StripeBillingClient`. `createStripeSdk` sends it to the Stripe SDK, with the same default in `DEFAULT_STRIPE_API_VERSION`. It is not a credential and it is not a US/BR split.

### `STRIPE_MAX_RETRIES`

Functional and global. `parseEnv` defaults it to `2` and stores a number. Both clients receive that number as `maxNetworkRetries`. The SDK option is set only when the number is finite. It is not a credential and it is not a US/BR split. No test asserts the default or that both clients share it.

### Fallback

| Legacy input | Effect today | After this change |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` only | Becomes the US secret. BR stays empty. | Ignored. US secret stays empty. |
| `STRIPE_WEBHOOK_SECRET` only | Becomes the US webhook secret. BR stays empty. | Ignored. US webhook secret stays empty. |
| Regional key and legacy key both set | Regional key wins (`firstNonEmpty` order). Legacy value is still stored on `env.STRIPE_SECRET_KEY` / `env.STRIPE_WEBHOOK_SECRET`. | Only the regional key is used. Legacy names are not on the resolved env. |
| `STRIPE_BR_*` | No fallback from the legacy names. | Unchanged. |

`tests/env.parse.test.js` never asserts this alias. CI (`.github/workflows/ci.yml`) already injects the regional secrets and does not set the legacy names.

### Where the old names appear besides runtime

- Templates: `.env.example` and `.env.qa.example` still list `STRIPE_SECRET_KEY=` and `STRIPE_WEBHOOK_SECRET=` next to the regional keys. `STRIPE_API_VERSION` and `STRIPE_MAX_RETRIES` belong in those files and stay.
- Local `.env`: the active block is already the regional keys plus the two globals. The legacy secret and webhook lines are comments. Do not commit `.env`.
- Current operator docs that tell someone the alias still works: `docs/production-go-live.md`, `docs-new/FEATURE_STRIPE_SEPARAR_PAISES/COMO-CONFIGURAR-STRIPE.md`, `o-que-alterar-para-funcionar.md`, `contexto.md`, `docs-new/other-routers/ROTA_STRIPE_WEBHOOK.md`, `docs/other-routers/ROTA_STRIPE_WEBHOOK.md`, `docs-new/checkout/CHECKOUT_RULES.md`, `docs-new/subscription-checkout/01-onboarding-subscription-checkout.md`, `docs-new/subscription-checkout/02-fluxo-stripe-first.md`, `docs-new/subscription-checkout/04-stripe-create-webhook-e-efeitos.md`, `docs-new/other-routers/APLICACAO_POS_CHECKOUT.md`, `docs-new/BUG_CHECKOUT_BACK_AND_FRONT_END/STRIPE_CLI_WEBHOOK_LOCAL.md`, and `docs-new/FEATURE_ALTERAR_QA-APP-PARA-SUBDOMINIO-QA-APP/DEPLOY-QA-SUBDOMINIOS.md`.
- Spec conflict: `openspec/specs/production-readiness/spec.md` requires production to accept "dedicated `STRIPE_US_*` values, or the legacy `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` aliases".
- Historical WordPress/PHP notes under `docs/checkout/`, `docs/subscription-checkout/`, `docs/rotes/`, and `docs/other-routers/APLICACAO_POS_CHECKOUT.md` describe the old plugin. They are not the Node process. This change does not rewrite that archaeology.
- Store and admin: no matches for the four backend names. The store reads `VITE_STRIPE_US_AUTOMATIC_TAX` only.

### US and BR differences that stay

- Secrets and webhook signing secrets are per account. Brazil never inherited the legacy names.
- `STRIPE_US_AUTOMATIC_TAX` is applied only to the US client. The BR client is constructed with `automaticTaxEnabled: false`.
- `STRIPE_BR_ENABLED` gates BR object creation (`stripe_br_disabled`). It does not silence a webhook for a subscription already stored as `br`. There is no US equivalent flag.
- Webhook URLs: `/stripe/v1/webhook/us` and the unscoped `/stripe/v1/webhook` verify with the US secret. `/stripe/v1/webhook/br` verifies with the BR secret. A signature for one account is not tried against the other secret.
- Production already requires both accounts' secrets and an explicit `true` or `false` for `STRIPE_BR_ENABLED`, even when the flag is `false`.
- API version and network retries are shared. Currency and catalog stay on the account chosen by address country.

## Current behavior

US checkout, preview, coupons, and both US webhook paths authenticate with `STRIPE_US_SECRET_KEY` / `STRIPE_US_WEBHOOK_SECRET` after the legacy fallback. BR checkout creates Stripe objects only when `STRIPE_BR_ENABLED` is true and `STRIPE_BR_SECRET_KEY` is set; otherwise `stripe_br_disabled` or `stripe_br_not_configured`. Missing US credentials still say `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` in the error message.

## Desired behavior

Operators set the regional block only:

```env
STRIPE_API_VERSION=2025-09-30.clover
STRIPE_MAX_RETRIES=2

STRIPE_US_SECRET_KEY=
STRIPE_US_WEBHOOK_SECRET=
STRIPE_US_AUTOMATIC_TAX=true

STRIPE_BR_SECRET_KEY=
STRIPE_BR_WEBHOOK_SECRET=
STRIPE_BR_ENABLED=false
```

Each operation uses the account for that country. There is no silent fallback to `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`. The two SDK settings stay global.

## Scope

In scope: env parsing, production boot wording, Stripe client construction only where it still names the legacy variables, error messages that name those variables, env templates, the uncommitted local `.env`, current operator docs, and tests that lock the alias out.

Out of scope: removing `POST /stripe/v1/webhook` (it remains the US path), changing `STRIPE_BR_ENABLED` or `STRIPE_US_AUTOMATIC_TAX`, splitting API version or retries per country, storefront publishable keys, and rewriting PHP migration notes.

## Risks

- A host whose `.env` has only the legacy secret will lose the US account until that value is copied to `STRIPE_US_SECRET_KEY` and `STRIPE_US_WEBHOOK_SECRET`. This workspace `.env` already uses the regional names for the live values.
- Clients that match the English sentence `STRIPE_SECRET_KEY is not configured.` would see a different message. Error codes stay.
- Zod strips unknown keys, so deleting the schema fields is what stops the alias. Leaving the `firstNonEmpty` fallback in place after the schema change would also stop it, but the fallback line itself must go so the alias cannot return.

## Acceptance

- A process with only `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` has empty US credentials. In production that process exits before listen.
- A process with the regional keys behaves as it does today, including shared API version and retries.
- `rg` over `src/` finds no read of `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.
- `.env.example` and `.env.qa.example` list the regional credentials and the two globals, and do not list the legacy credential names.

## Capabilities

### New Capabilities

- `stripe-region-config`: US and BR Stripe credentials are explicit, legacy secret and webhook names are not read, and API version plus network retries stay one shared SDK setting.

### Modified Capabilities

- `production-readiness`: production boot accepts only `STRIPE_US_SECRET_KEY` and `STRIPE_US_WEBHOOK_SECRET` for the US account. The legacy aliases no longer satisfy that check.

## Impact

- Backend only: `src/config/env.js`, Stripe missing-secret messages, `src/core/logger.js` redact list, `.env.example`, `.env.qa.example`, local `.env`, `docs/production-go-live.md`, and the current operator docs listed above.
- `openspec/specs/production-readiness` changes when this delta is archived.
- Store, admin, CI workflow, webhook URL map, and `stripe-shipping-product` stay as they are.
