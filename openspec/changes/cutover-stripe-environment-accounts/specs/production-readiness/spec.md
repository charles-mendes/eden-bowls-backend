# Spec Delta

## MODIFIED Requirements

### Requirement: Go-live checklist

The repository MUST contain a production go-live checklist that names the existing variables and hosts, and MUST include: environment variables, `edenbowls.com` and `edenbowls.com.br`, CORS, Stripe US and Stripe BR webhook URLs `POST /stripe/v1/webhook/us` and `POST /stripe/v1/webhook/br`, UPS, SMTP, MySQL, `npm run migrate`, and rollback by restoring a database dump taken before that migrate. The checklist MUST state that `edenbowls.com` and `edenbowls.com.br` currently serve the static landing, that `www` redirects to the apex, and that production API and admin hostnames are not declared in the Caddyfile. It MUST NOT invent those hostnames. It MUST record that the store constant `DOMAIN_COM_URL` is `https://www.edenbowls.com` while Caddy redirects that host to `https://edenbowls.com`.

The checklist MUST state that QA API deploy follows a successful CI run on `main` and reads the host `.env`, and that `EDEN_RUNTIME` MUST already be set on that host before a build that requires it is merged. It MUST state that this repo has no production deploy workflow. The checklist MUST also record the operator-supplied Stripe destinations `https://qa-api.edenbowls.com/stripe/v1/webhook/br`, `https://qa-api.edenbowls.com/stripe/v1/webhook/us`, `https://api.edenbowls.com/stripe/v1/webhook/br`, and `https://api.edenbowls.com/stripe/v1/webhook/us`. It MUST state that `api.edenbowls.com` is the production webhook host supplied for Stripe and that this hostname is not a host in this repo's Caddyfile. It MUST NOT treat that URL as a Caddy server name to add. It MUST state that a live webhook test is blocked until someone outside this repository has provisioned DNS, TLS, and a reverse proxy so those two paths reach the production API. It MUST state that production Stripe rollback stops the production store, because `STRIPE_BR_ENABLED=false` only stops Brazil and the United States account has no matching flag. It MUST state that the two live webhook endpoints stay disabled until `api.edenbowls.com` routes both paths and the live signing secrets are loaded. It MUST state that live secrets are written only after `stripe_subscriptions` and the three `_hsr_stripe_customer_id` keys are counted and are each zero, and that a seed price id in the ledger does not count as empty. It MUST state that the live endpoints are enabled only after that write and an API restart. Production has no previous working Stripe env to restore. The QA Stripe rollback MUST name the dump taken before the retire script.

#### Scenario: Checklist names the existing webhook paths

- **WHEN** an operator reads the go-live checklist
- **THEN** it lists `POST /stripe/v1/webhook/us` and `POST /stripe/v1/webhook/br`, and it does not introduce a third webhook path as the production contract

#### Scenario: Checklist records the four Stripe destinations

- **WHEN** an operator reads the go-live checklist
- **THEN** it lists the QA and production Brazil and United States webhook URLs, and it states that `api.edenbowls.com` is not declared in this repo's Caddyfile

#### Scenario: The host label exists before the boot guard is deployed

- **WHEN** an operator reads the go-live checklist before merging a build that requires `EDEN_RUNTIME`
- **THEN** it states that QA deploy follows CI on `main`, that the QA host `.env` must already contain `EDEN_RUNTIME`, and that this repo has no production deploy workflow

#### Scenario: Live webhook test waits for the external host

- **WHEN** an operator reads the go-live checklist before `api.edenbowls.com` answers
- **THEN** the checklist blocks the live signed-event check until DNS, TLS, and the reverse proxy route both webhook paths to the production API

#### Scenario: Production Stripe rollback does not restore a previous env

- **WHEN** an operator follows the checklist after a failed production Stripe cutover
- **THEN** the documented Stripe rollback is the production store stopped, plus `STRIPE_BR_ENABLED=false` for Brazil, not a restore of a previous live secret and not a United States flag that does not exist, and the QA rollback names the pre-retire dump

#### Scenario: Rollback path is a dump restore

- **WHEN** an operator follows the checklist after a failed migration
- **THEN** the documented rollback is restoring the dump taken before `npm run migrate`, not an undocumented schema change
