# Design

## Context

See proposal.md for why the alias exists and which files still mention it. The live path is `parseEnv` in `src/config/env.js`: `STRIPE_US_SECRET_KEY` is `firstNonEmpty(US, STRIPE_SECRET_KEY)` and `STRIPE_US_WEBHOOK_SECRET` is `firstNonEmpty(US webhook, STRIPE_WEBHOOK_SECRET)`. `rawEnvSchema` is a Zod object, which strips unknown keys, so removing a name from the schema is what stops `parseEnv` from seeing it. Callers after that (`createStripeAccountsFromEnv`, `src/index.js`) already pass `env.STRIPE_US_*` and `env.STRIPE_BR_*`. They do not read `env.STRIPE_SECRET_KEY`.

`STRIPE_API_VERSION` and `STRIPE_MAX_RETRIES` are already one pair of values copied onto both `StripeBillingClient` instances. `STRIPE_US_AUTOMATIC_TAX` is passed only to the US client. The BR client is constructed with `automaticTaxEnabled: false`.

## Goals / Non-Goals

**Goals:**

- Delete the credential alias in the schema, the resolved object, and the `firstNonEmpty` calls.
- Leave the shared SDK settings and the per-account flags on their current keys.
- Make 503 messages name the regional variable without changing error codes.
- Lock the alias out with parse tests, including production boot.

**Non-Goals:**

- Removing `POST /stripe/v1/webhook`. It stays registered as the US account in `stripe-webhook.routes.js`.
- Per-country API version or retry counts.
- Rewriting `docs/checkout/`, `docs/subscription-checkout/`, `docs/rotes/`, or `docs/other-routers/APLICACAO_POS_CHECKOUT.md`. Those describe the WordPress plugin.

## Decisions

### Drop the legacy names from the schema and from the resolved object

Remove `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from `rawEnvSchema` and from the object `parseEnv` returns. Set the US fields from only `rawEnv.STRIPE_US_SECRET_KEY` and `rawEnv.STRIPE_US_WEBHOOK_SECRET`.

Alternative: keep the schema fields but stop using them in `firstNonEmpty`. Rejected. The resolved object would still expose the legacy names, and a later edit could wire the alias back without a schema change.

Alternative: reject the process when the legacy names are present. Rejected. A commented or leftover value in a host env should be inert, matching the shipping-product removal. Production fails only when the regional US values are missing, not because a stale name is also set.

### Keep the two SDK settings global

Do not rename `STRIPE_API_VERSION` or `STRIPE_MAX_RETRIES`, and do not add `STRIPE_US_` / `STRIPE_BR_` copies. `createStripeAccountsFromEnv` already passes one `apiVersion` and one `maxNetworkRetries` into both clients. Defaults stay `2025-09-30.clover` and `2`. `DEFAULT_STRIPE_API_VERSION` stays the same string for a client built without `parseEnv`.

Alternative: hardcode both and delete the env keys. Rejected. Operators pin the Dashboard API version with `STRIPE_API_VERSION`, and the retry count is a real SDK option (`maxNetworkRetries`) with a tested default path in `createStripeSdk`.

### Name the regional variable in the 503 text

Keep codes `stripe_secret_missing`, `stripe_webhook_secret_missing`, `stripe_br_not_configured`, and `stripe_br_disabled`.

- US missing secret: message names `STRIPE_US_SECRET_KEY`. The registry's US branch and `StripeBillingClient.ensureClient` both change. `ensureClient` chooses the name from `this.account`. A Brazil client invoked directly throws `stripe_secret_missing` and names `STRIPE_BR_SECRET_KEY`. The account registry still throws `stripe_br_not_configured` for an enabled Brazil operation before that client is used.
- Webhook missing secret: `StripeWebhookService.handle` names `STRIPE_US_WEBHOOK_SECRET` or `STRIPE_BR_WEBHOOK_SECRET` from the path account. `constructEvent` receives that same message only if it still checks an empty secret; the service already throws first.

`src/core/logger.js` keeps the legacy names on the redact list next to the regional names. That list is log-field redaction, not an env read.

### Docs and templates

`.env.example` and `.env.qa.example` drop the two legacy credential lines and keep the globals above the regional block. The local `.env` drops the commented legacy secret and webhook lines and is not committed. Operator docs listed in the proposal lose the "legacy still works" sentences. That list includes `docs-new/subscription-checkout/01-onboarding-subscription-checkout.md` and `02-fluxo-stripe-first.md` because those notes describe the Node API. PHP notes under `docs/checkout/`, `docs/subscription-checkout/`, `docs/rotes/`, and `docs/other-routers/APLICACAO_POS_CHECKOUT.md` are not edited.

## Risks / Trade-offs

- [Host still has only `STRIPE_SECRET_KEY`] → US checkout and production boot fail until the value is copied to `STRIPE_US_SECRET_KEY` and `STRIPE_US_WEBHOOK_SECRET`. This workspace `.env` already has the regional keys as the live values. QA and any other host env outside the repo must be checked at deploy; the checklist states that.
- [A test or client matches the old English sentence] → codes stay, so code-based handling is unchanged. Update assertions that match the sentence.
- [Zod strip hides a forgotten fallback] → delete the `firstNonEmpty` legacy arguments anyway, and assert in tests that a source object containing the legacy names does not fill the US fields.

## Migration Plan

1. On each deployed env, if the live secret is only under `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, copy it to `STRIPE_US_SECRET_KEY` / `STRIPE_US_WEBHOOK_SECRET` before this change ships. Do not point Brazil at those values.
2. Ship the parser change, message change, templates, and docs together.
3. Rollback is restoring the two `firstNonEmpty` fallbacks and the schema fields. No database migration and no Stripe object rewrite.

## Open Questions

None. The unscoped webhook URL stays, and the SDK settings stay global.
