# Spec Delta

## Purpose

Keeps Stripe credentials and webhook secrets explicit for the United States and Brazil accounts, and keeps API version and network retries as one shared SDK setting.

## ADDED Requirements

### Requirement: Regional credentials are the only Stripe secrets

The API MUST read the United States secret from `STRIPE_US_SECRET_KEY` and the United States webhook signing secret from `STRIPE_US_WEBHOOK_SECRET`. The API MUST read the Brazil secret from `STRIPE_BR_SECRET_KEY` and the Brazil webhook signing secret from `STRIPE_BR_WEBHOOK_SECRET`. Checkout, preview, coupons, and webhook verification for a country MUST use that country's account. The API MUST NOT copy `STRIPE_SECRET_KEY` into the United States secret and MUST NOT copy `STRIPE_WEBHOOK_SECRET` into the United States webhook secret. A process environment that still defines those legacy names MUST NOT change which key or signing secret is used. The resolved configuration MUST NOT expose `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.

#### Scenario: Legacy secret does not operate the US account

- **WHEN** `NODE_ENV` is not `production`, `STRIPE_SECRET_KEY` is set, and `STRIPE_US_SECRET_KEY` is absent or blank
- **THEN** United States Stripe calls fail as not configured and the legacy value is not used as the US secret

#### Scenario: Legacy webhook secret does not verify US events

- **WHEN** `NODE_ENV` is not `production`, `STRIPE_WEBHOOK_SECRET` is set, and `STRIPE_US_WEBHOOK_SECRET` is absent or blank
- **THEN** `POST /stripe/v1/webhook/us` and `POST /stripe/v1/webhook` respond `503` and do not verify the signature with the legacy value

#### Scenario: Legacy names are ignored when regional keys are set

- **WHEN** `STRIPE_US_SECRET_KEY` and `STRIPE_SECRET_KEY` are both non-blank, and `STRIPE_US_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_SECRET` are both non-blank
- **THEN** the US account uses `STRIPE_US_SECRET_KEY` and `STRIPE_US_WEBHOOK_SECRET`, and the legacy values are not read

#### Scenario: Resolved configuration omits the legacy names

- **WHEN** the process environment sets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` together with the regional US secrets
- **THEN** the resolved configuration exposes `STRIPE_US_SECRET_KEY` and `STRIPE_US_WEBHOOK_SECRET` and does not expose `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`

#### Scenario: Brazil flag off does not use the legacy secret

- **WHEN** `NODE_ENV` is not `production`, `STRIPE_BR_ENABLED` is false, `STRIPE_BR_SECRET_KEY` is absent, and `STRIPE_SECRET_KEY` is set
- **THEN** Brazil creation fails with `stripe_br_disabled` and does not use `STRIPE_SECRET_KEY`

#### Scenario: Brazil enabled without a Brazil secret does not use the legacy secret

- **WHEN** `NODE_ENV` is not `production`, `STRIPE_BR_ENABLED` is true, `STRIPE_BR_SECRET_KEY` is absent, and `STRIPE_SECRET_KEY` is set
- **THEN** Brazil creation fails with `stripe_br_not_configured` and does not use `STRIPE_SECRET_KEY`

### Requirement: Shared SDK settings stay global

`STRIPE_API_VERSION` and `STRIPE_MAX_RETRIES` MUST apply to both the United States and Brazil Stripe clients. An unset `STRIPE_API_VERSION` MUST resolve to `2025-09-30.clover`. An unset `STRIPE_MAX_RETRIES` MUST resolve to `2`. The API MUST NOT require a per-country copy of either setting.

#### Scenario: Both accounts use the configured API version and retries

- **WHEN** `STRIPE_API_VERSION` and `STRIPE_MAX_RETRIES` are set and both account secrets are present
- **THEN** the United States client and the Brazil client are constructed with that same API version and that same retry count

#### Scenario: Defaults apply when the globals are unset

- **WHEN** `STRIPE_API_VERSION` and `STRIPE_MAX_RETRIES` are absent and a regional secret is present
- **THEN** that account's client uses API version `2025-09-30.clover` and `2` network retries

### Requirement: Account-specific settings stay on one account

`STRIPE_US_AUTOMATIC_TAX` MUST affect only the United States client. The Brazil client MUST NOT enable automatic tax from that variable. `STRIPE_BR_ENABLED` MUST gate creation of Brazil Stripe objects and MUST NOT gate the United States account. A webhook for a subscription already stored as `br` MUST still be accepted on `POST /stripe/v1/webhook/br` when the Brazil webhook secret is configured, even if `STRIPE_BR_ENABLED` is `false`.

#### Scenario: Automatic tax is US-only

- **WHEN** `STRIPE_US_AUTOMATIC_TAX` is true and a Brazil checkout is created
- **THEN** the Brazil subscription is created with automatic tax disabled

#### Scenario: US checkout does not require the Brazil flag

- **WHEN** `STRIPE_BR_ENABLED` is `false` and `STRIPE_US_SECRET_KEY` is set
- **THEN** a United States checkout can still create a subscription on the US account

#### Scenario: Stored Brazil subscription webhook ignores the kill switch

- **WHEN** `STRIPE_BR_ENABLED` is false, `STRIPE_BR_WEBHOOK_SECRET` is set, and a valid signature arrives at `POST /stripe/v1/webhook/br` for a subscription stored as `br`
- **THEN** the API accepts the event and does not respond with `stripe_br_disabled`

### Requirement: Missing-secret errors name the regional variable

When the United States secret is missing, the API MUST respond `503` with code `stripe_secret_missing` and a message that names `STRIPE_US_SECRET_KEY`. When the Brazil secret is missing for a Brazil operation that is otherwise enabled, the account registry MUST respond `503` with code `stripe_br_not_configured` before that client is used. A Brazil billing client invoked directly with no secret MUST respond `503` with code `stripe_secret_missing` and a message that names `STRIPE_BR_SECRET_KEY`. When a webhook signing secret for the path's account is missing, the API MUST respond `503` with code `stripe_webhook_secret_missing` and a message that names `STRIPE_US_WEBHOOK_SECRET` or `STRIPE_BR_WEBHOOK_SECRET` for that path. The message MUST NOT tell the operator to set `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.

#### Scenario: US checkout without a US secret

- **WHEN** a United States checkout runs and `STRIPE_US_SECRET_KEY` is blank
- **THEN** the response is `503` with code `stripe_secret_missing` and the message names `STRIPE_US_SECRET_KEY`

#### Scenario: US webhook without a US signing secret

- **WHEN** `POST /stripe/v1/webhook/us` or `POST /stripe/v1/webhook` runs and `STRIPE_US_WEBHOOK_SECRET` is blank
- **THEN** the response is `503` with code `stripe_webhook_secret_missing` and the message names `STRIPE_US_WEBHOOK_SECRET`

#### Scenario: Brazil webhook without a Brazil signing secret

- **WHEN** `POST /stripe/v1/webhook/br` runs and `STRIPE_BR_WEBHOOK_SECRET` is blank
- **THEN** the response is `503` with code `stripe_webhook_secret_missing` and the message names `STRIPE_BR_WEBHOOK_SECRET`

#### Scenario: Brazil enabled without a Brazil secret

- **WHEN** `NODE_ENV` is not `production`, `STRIPE_BR_ENABLED` is true, and `STRIPE_BR_SECRET_KEY` is blank
- **THEN** the account registry responds `503` with code `stripe_br_not_configured`

#### Scenario: Direct Brazil client without a secret

- **WHEN** a Brazil billing client is invoked directly and its secret is blank
- **THEN** the response is `503` with code `stripe_secret_missing` and the message names `STRIPE_BR_SECRET_KEY`
