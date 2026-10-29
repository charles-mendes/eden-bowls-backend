# legal-documents Specification

## Purpose
Keeps the privacy policy and the terms of use as published versions per market, served to the store and recorded with each consent, so publishing a new text needs no deploy and every consent names the text the customer saw.

## Requirements

### Requirement: Legal documents are published versions per market

Each market (BR in pt-BR, US in en-US) MUST have, for each kind (`privacy`, `terms`), a list of published versions. Each version MUST have a version id in the form `YYYY-MM-DD`, a Markdown body of 1 to 100,000 characters, a publication time and the publisher. The current version MUST be the most recently published. A published version MUST NOT be edited or deleted. Publishing MUST require `legal.write` (admin only), MUST refuse a version id already published for that market and kind with HTTP 409 `legal_version_taken`, and MUST be recorded in the admin audit log as `legal.document.publish`. The deploy MUST publish version `2026-09-13` of both kinds in both markets with the text the store shows today.

#### Scenario: Publish new terms in US

- **WHEN** an admin publishes US `terms` version `2026-11-01`
- **THEN** it becomes the current US terms, the US `2026-09-13` version stays readable, and the BR terms are unchanged

#### Scenario: Version id already used

- **WHEN** an admin publishes BR `privacy` version `2026-09-13`
- **THEN** the API returns 409 `legal_version_taken`

### Requirement: Public route serves the current version

`GET /api/v1/legal/:kind?market=<BR|US>` MUST return HTTP 200 with the current version id, publication time and body, without authentication. An unknown kind MUST return 404 and an unknown market 400 `invalid_market`.

#### Scenario: Store reads the BR privacy policy

- **WHEN** the store requests `GET /api/v1/legal/privacy?market=BR`
- **THEN** the response holds the current BR privacy version and its pt-BR body

### Requirement: Consent records the version the customer saw

A consent to the privacy policy or terms, given at sign-in or at checkout, MUST record the version id the client sends when it is a published version of the market (the customer's market at sign-in, the market of the delivery address at checkout). Without a version, the current version of the market MUST be recorded. An unknown version MUST NOT block the sign-in or the checkout: the API MUST record the current version and log a warning with the version it received.

#### Scenario: Customer accepts the version shown

- **WHEN** a BR customer signs in with `termsVersion` `2026-09-13` while `2026-11-01` is already current
- **THEN** the consent records `2026-09-13`

#### Scenario: Stale client sends an unknown version

- **WHEN** a client sends `privacyVersion` `2020-01-01`
- **THEN** the sign-in succeeds, the consent records the current privacy version of the market, and a warning is logged

#### Scenario: Checkout with a version the store loaded before a publication

- **WHEN** a BR customer completes a checkout with `terms_version` `2026-10-22` while `2026-11-01` was published after the store loaded the page
- **THEN** the checkout consent records `2026-10-22`

#### Scenario: Checkout with an unknown version

- **WHEN** a US customer completes a checkout with `privacy_version` `2020-01-01`
- **THEN** the checkout goes on, the consent records the current US privacy version, and a warning is logged

### Requirement: Checkout requires accepting the terms and privacy policy

`POST /api/v1/onboarding/subscription/checkout` MUST require `legal_consent.accepted` to be `true`. Otherwise the API MUST answer HTTP 422 `legal_consent_required` and MUST NOT create or reuse a Stripe subscription, charge the customer or record a consent. `legal_consent.terms_version` and `legal_consent.privacy_version` are optional strings of at most 32 characters.

#### Scenario: Box not ticked

- **WHEN** a customer posts a checkout with `legal_consent.accepted` `false`
- **THEN** the API answers 422 `legal_consent_required` and Stripe is not called

#### Scenario: Old client without the field

- **WHEN** a client posts a checkout without `legal_consent`
- **THEN** the API answers 422 `legal_consent_required`

### Requirement: Checkout records the acceptance before charging

Each checkout request with `legal_consent.accepted` `true` that passes the checkout validations MUST record two `granted` consents, `privacy_policy` and `terms`, with source `checkout`, the customer, the hashed IP and the user agent, before the Stripe subscription is created or reused. A retry of the same checkout MUST record them again: the trail lists every acceptance. If they cannot be recorded, the checkout MUST fail with HTTP 503 and MUST NOT charge.

#### Scenario: Accepted checkout

- **WHEN** a customer completes a checkout with the box ticked
- **THEN** the consent trail holds a `privacy_policy` and a `terms` consent with source `checkout` and the recorded versions, created before the Stripe subscription

#### Scenario: Checkout refused by another validation

- **WHEN** a checkout with the box ticked is refused because the delivery area is not verified
- **THEN** no checkout consent is recorded

#### Scenario: Consent trail unavailable

- **WHEN** recording the checkout consent fails
- **THEN** the API answers 503, no Stripe subscription is created or reused and the customer is not charged
