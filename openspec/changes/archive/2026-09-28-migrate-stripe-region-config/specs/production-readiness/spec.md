# Spec Delta

## MODIFIED Requirements

### Requirement: Production boot requires secrets

When `NODE_ENV` is `production`, the process MUST exit during startup, before it listens, if any of the following is missing, blank, or equal to a known local placeholder:

- JWT signing secret (`JWT_AUTH_SECRET_KEY`), including the placeholder `change-this-in-production`
- OTP pepper (`AUTH_OTP_PEPPER` or `AUTH_SALT`), including the fallback `hsr-default-salt`
- SMTP host and from-address (`AUTH_SMTP_HOST` or `HSR_SMTP_HOST`, and `AUTH_MAIL_FROM` or `HSR_MAIL_FROM`)
- Stripe US secret and US webhook secret (`STRIPE_US_SECRET_KEY` and `STRIPE_US_WEBHOOK_SECRET` only)
- Stripe BR secret and BR webhook secret (`STRIPE_BR_SECRET_KEY`, `STRIPE_BR_WEBHOOK_SECRET`)
- UPS client id, client secret, and account number
- Metrics token
- Database password (`DB_PASSWORD`)

`JWT_AUTH_ISSUER` MUST be an `https` URL and MUST NOT use `localhost`. In production, `STRIPE_BR_ENABLED` MUST be present and its trimmed value MUST be `true` or `false`, compared case-insensitively. `1`, `yes`, `on`, and any other token MUST NOT count as an explicit choice. `STRIPE_BR_SECRET_KEY` and `STRIPE_BR_WEBHOOK_SECRET` MUST be set in production whether `STRIPE_BR_ENABLED` is `true` or `false`. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` MUST NOT satisfy the US secret or US webhook secret check. Development and test MUST still start when these values are absent.

#### Scenario: Production refuses the OTP fallback pepper

- **WHEN** `NODE_ENV` is `production` and neither `AUTH_OTP_PEPPER` nor `AUTH_SALT` is a non-placeholder value
- **THEN** the process exits before listening and does not sign OTP hashes with `hsr-default-salt`

#### Scenario: Production rejects a non-literal BR flag

- **WHEN** `NODE_ENV` is `production` and `STRIPE_BR_ENABLED` is `1` or `yes`
- **THEN** the process exits before listening

#### Scenario: Production rejects a legacy Stripe alias

- **WHEN** `NODE_ENV` is `production` and `STRIPE_US_SECRET_KEY` or `STRIPE_US_WEBHOOK_SECRET` is blank while `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` is set
- **THEN** the process exits before listening and does not use the legacy value for the US account

#### Scenario: Production starts with a complete regional Stripe configuration

- **WHEN** `NODE_ENV` is `production`, `STRIPE_BR_ENABLED` is `false`, and every secret listed in this requirement is a non-placeholder value, including `STRIPE_US_SECRET_KEY`, `STRIPE_US_WEBHOOK_SECRET`, `STRIPE_BR_SECRET_KEY`, and `STRIPE_BR_WEBHOOK_SECRET`
- **THEN** the process listens

#### Scenario: Development still starts without Stripe

- **WHEN** `NODE_ENV` is `development` or `test` and the Stripe, SMTP, and UPS variables are empty
- **THEN** the process starts and keeps the current development defaults
