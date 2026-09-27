# production-readiness Specification

## Purpose

Makes a production boot of the Eden Bowls API fail closed on missing secrets, keep auth cookies and probes honest, and persist uploaded files and UPS labels across container replacement.

## Requirements

### Requirement: Production boot requires secrets

When `NODE_ENV` is `production`, the process MUST exit during startup, before it listens, if any of the following is missing, blank, or equal to a known local placeholder:

- JWT signing secret (`JWT_AUTH_SECRET_KEY`), including the placeholder `change-this-in-production`
- OTP pepper (`AUTH_OTP_PEPPER` or `AUTH_SALT`), including the fallback `hsr-default-salt`
- SMTP host and from-address (`AUTH_SMTP_HOST` or `HSR_SMTP_HOST`, and `AUTH_MAIL_FROM` or `HSR_MAIL_FROM`)
- Stripe US secret and US webhook secret (dedicated `STRIPE_US_*` values, or the legacy `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` aliases)
- Stripe BR secret and BR webhook secret (`STRIPE_BR_SECRET_KEY`, `STRIPE_BR_WEBHOOK_SECRET`)
- UPS client id, client secret, and account number
- Metrics token
- Database password (`DB_PASSWORD`)

`JWT_AUTH_ISSUER` MUST be an `https` URL and MUST NOT use `localhost`. In production, `STRIPE_BR_ENABLED` MUST be present and its trimmed value MUST be `true` or `false`, compared case-insensitively. `1`, `yes`, `on`, and any other token MUST NOT count as an explicit choice. When the value is `true`, the BR secret and BR webhook secret required above are the ones the BR account uses. Development and test MUST still start when these values are absent.

#### Scenario: Production refuses the OTP fallback pepper

- **WHEN** `NODE_ENV` is `production` and neither `AUTH_OTP_PEPPER` nor `AUTH_SALT` is a non-placeholder value
- **THEN** the process exits before listening and does not sign OTP hashes with `hsr-default-salt`

#### Scenario: Production rejects a non-literal BR flag

- **WHEN** `NODE_ENV` is `production` and `STRIPE_BR_ENABLED` is `1` or `yes`
- **THEN** the process exits before listening

#### Scenario: Development still starts without Stripe

- **WHEN** `NODE_ENV` is `development` or `test` and the Stripe, SMTP, and UPS variables are empty
- **THEN** the process starts and keeps the current development defaults

### Requirement: UPS environment is explicit

The API MUST pass `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`, and `UPS_ENV` from the environment into the UPS client. `UPS_ENV` MUST be `production` or `cie`. The value `production` MUST select `https://onlinetools.ups.com`. The value `cie` MUST select `https://wwwcie.ups.com`. In production the process MUST NOT substitute `cie` when `UPS_ENV` is unset. Outside production, an unset `UPS_ENV` MAY remain `cie`.

#### Scenario: Production setting is not discarded

- **WHEN** the environment sets `UPS_ENV=production` and the UPS credentials are present
- **THEN** rate and shipment calls use `https://onlinetools.ups.com`

#### Scenario: Production without UPS_ENV does not boot

- **WHEN** `NODE_ENV` is `production` and `UPS_ENV` is unset
- **THEN** the process exits before listening and does not call `https://wwwcie.ups.com`

### Requirement: Refresh cookie stays host-only and secure

The refresh cookie MUST remain `HttpOnly`, path `/api/v1/auth` unless `AUTH_REFRESH_COOKIE_PATH` overrides it, and `Secure` whenever `NODE_ENV` is `production`. Production MUST reject a non-empty `AUTH_REFRESH_COOKIE_DOMAIN`, including `.edenbowls.com`. When `CORS_ORIGINS` contains both an `edenbowls.com` origin and an `edenbowls.com.br` origin, production MUST require `AUTH_REFRESH_COOKIE_SAME_SITE=none`. `SameSite=None` MUST still require `Secure`.

#### Scenario: Shared parent domain is rejected

- **WHEN** `NODE_ENV` is `production` and `AUTH_REFRESH_COOKIE_DOMAIN` is `.edenbowls.com`
- **THEN** the process exits before listening and does not set that Domain attribute

#### Scenario: Both store domains require SameSite None

- **WHEN** `NODE_ENV` is `production` and `CORS_ORIGINS` lists `https://edenbowls.com` and `https://edenbowls.com.br` and `AUTH_REFRESH_COOKIE_SAME_SITE` is `lax`
- **THEN** the process exits before listening

#### Scenario: Cookie attributes on a successful login

- **WHEN** a production process with `SameSite=none` and `Secure` issues a refresh token
- **THEN** the `Set-Cookie` header includes `HttpOnly`, `Secure`, and `SameSite=None`, and omits `Domain`

### Requirement: Production CORS is an explicit HTTPS allow-list

In production, `CORS_ORIGINS` MUST be a non-empty comma-separated list of `https` origins. The process MUST reject the development default `http://localhost:5173`, `http://localhost:5174`, and `http://localhost:5175`, and MUST reject any `http://` or `localhost` origin. An allowed browser origin MUST receive `Access-Control-Allow-Credentials: true` and its own origin echoed back. Any other `Origin` MUST NOT receive `Access-Control-Allow-Origin`. `OPTIONS` from a disallowed origin MUST stay `403`.

#### Scenario: Localhost allow-list fails production boot

- **WHEN** `NODE_ENV` is `production` and `CORS_ORIGINS` is the default localhost list
- **THEN** the process exits before listening

#### Scenario: Disallowed origin gets no CORS grant

- **WHEN** a production process receives `Origin: https://evil.example`
- **THEN** the response has no `Access-Control-Allow-Origin` header

### Requirement: Metrics are not anonymous in production

In production, `GET /metrics` MUST return `404` unless the request presents the configured metrics token. A token of a different length, a missing header, or a wrong token MUST also return `404` and MUST NOT cause a `500`. The body of a rejected request MUST NOT contain Prometheus text. Outside production, `GET /metrics` MUST keep returning Prometheus text without that token. `/health` and `/liveness` MUST stay unauthenticated and MUST NOT query MySQL.

#### Scenario: Anonymous metrics in production

- **WHEN** `NODE_ENV` is `production` and `GET /metrics` has no metrics token
- **THEN** the response status is `404` and the body does not contain process metrics

#### Scenario: Different-length metrics token

- **WHEN** `NODE_ENV` is `production` and the bearer token length differs from the configured metrics token
- **THEN** `GET /metrics` returns `404` and does not return `500`

#### Scenario: Liveness does not touch the database

- **WHEN** MySQL is down and a client calls `GET /liveness`
- **THEN** the response status is `200` and the body reports the process as alive

### Requirement: Readiness checks MySQL

`GET /readiness` MUST run a connectivity query against the configured MySQL database. When the query succeeds, the response MUST be `200` with a ready status. When the query fails or the database is not initialized, the response MUST be `503` with a not-ready status. The body MUST NOT include the database password, SQL text, or driver error details.

#### Scenario: Database accepts a query

- **WHEN** MySQL accepts the readiness query
- **THEN** `GET /readiness` returns `200`

#### Scenario: Database is down

- **WHEN** the readiness query fails
- **THEN** `GET /readiness` returns `503` and the body does not contain the database password or the driver error

### Requirement: Uploaded files and labels survive container replacement

Avatar, pet photo, feedback photo, and UPS label bytes MUST be written under configurable directories and MUST survive replacement of the API container. Production compose MUST mount those four directories from persistent volumes. The GeoIP database MAY stay on a read-only mount. UPS label writes MUST NOT target that read-only mount. The API MUST keep serving avatars, pet photos, and feedback photos as static files under `/avatars`, `/pet-photos`, and `/feedback-photos`. UPS label download MUST remain the authenticated admin route `GET /api/v1/admin/shipments/:id/label`.

#### Scenario: Label write is not on the read-only data mount

- **WHEN** the API container is started from the QA or local backend compose file
- **THEN** the UPS label directory is a writable persistent mount and is not the read-only `./data` mount used for the GeoIP database

#### Scenario: Public photo URL still resolves

- **WHEN** a pet photo has been stored and a client requests its `/pet-photos/` URL
- **THEN** the file is returned without an auth token

### Requirement: Go-live checklist

The repository MUST contain a production go-live checklist that names the existing variables and hosts, and MUST include: environment variables, `edenbowls.com` and `edenbowls.com.br`, CORS, Stripe US and Stripe BR webhook URLs `POST /stripe/v1/webhook/us` and `POST /stripe/v1/webhook/br`, UPS, SMTP, MySQL, `npm run migrate`, and rollback by restoring a database dump taken before that migrate. The checklist MUST state that `edenbowls.com` and `edenbowls.com.br` currently serve the static landing, that `www` redirects to the apex, and that production API and admin hostnames are not declared in the Caddyfile. It MUST NOT invent those hostnames. It MUST record that the store constant `DOMAIN_COM_URL` is `https://www.edenbowls.com` while Caddy redirects that host to `https://edenbowls.com`.

#### Scenario: Checklist names the existing webhook paths

- **WHEN** an operator reads the go-live checklist
- **THEN** it lists `POST /stripe/v1/webhook/us` and `POST /stripe/v1/webhook/br`, and it does not introduce a third webhook path as the production contract

#### Scenario: Rollback path is a dump restore

- **WHEN** an operator follows the checklist after a failed migration
- **THEN** the documented rollback is restoring the dump taken before `npm run migrate`, not an undocumented schema change
