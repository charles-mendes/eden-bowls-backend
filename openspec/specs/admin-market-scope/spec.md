# admin-market-scope Specification

## Purpose

Isolates Eden Bowls admin APIs by market so Brazil staff only observe Brazil records, United States staff only observe United States records, and admins observe both, using each record’s write-time market rather than a read-time inference chain.

## Requirements

### Requirement: Staff identity exposes assigned markets

The system SHALL persist operational staff markets in user meta alongside admin roles. `GET /api/v1/admin/me` MUST return `markets` as an array of `BR` and/or `US`, and MUST include derived permissions `market.br` and/or `market.us`. The access token MUST continue to identify only the user id; markets MUST be resolved from storage on each request.

#### Scenario: Admin session sees both markets

- **WHEN** an authenticated admin (or allowlisted email) calls `GET /api/v1/admin/me`
- **THEN** `markets` is `["BR","US"]` (order MAY vary) and both `market.br` and `market.us` are present in `permissions`

#### Scenario: Operator session sees one market

- **WHEN** an operator assigned `BR` calls `GET /api/v1/admin/me`
- **THEN** `markets` is `["BR"]` and `permissions` includes `market.br` and does not include `market.us`

### Requirement: Non-admin staff assignment requires exactly one market

When creating staff access or assigning an operational role other than `admin`, the system MUST require `market` of `BR` or `US`. Assigning `admin` MUST NOT require `market` and MUST treat the account as both markets. Existing last-admin, self-demote, self-delete, and allowlist locks MUST still apply.

#### Scenario: Invite operator without market is rejected

- **WHEN** an admin `POST /api/v1/admin/users` with role `operator` and no `market`
- **THEN** the system responds `400` and does not create the account

#### Scenario: Invite operator with market succeeds

- **WHEN** an admin `POST /api/v1/admin/users` with role `operator` and `market` `US`
- **THEN** the staff account is created and later `/admin/me` for that user returns `markets: ["US"]`

#### Scenario: Demoting last admin remains blocked

- **WHEN** the only remaining admin is assigned `operator` and `market` `BR`
- **THEN** the system responds `422` with the existing last-admin error and does not change roles or markets

### Requirement: Admin routes declare a market scope

Every authenticated `/api/v1/admin/*` route MUST declare `marketScope` of `none`, `query`, or `record`. Only `GET /api/v1/admin/me` and `POST /api/v1/admin/me/password` MAY use `none`. Adding a `none` route outside that set is a specification change.

#### Scenario: Session routes are none

- **WHEN** a caller hits `/api/v1/admin/me` or `/api/v1/admin/me/password`
- **THEN** the route is in scope `none` and does not require an assigned market

#### Scenario: Undeclared admin route is invalid

- **WHEN** an authenticated admin route is registered without `marketScope`
- **THEN** automated checks MUST fail

### Requirement: Query scope filters lists in storage by canonical market

For `query` routes, the system MUST apply the actor’s markets in the same database filter used for pagination and totals. CSV and metrics that share the list MUST use that filter. If the request asks for a market or Stripe account outside `identity.markets`, the system MUST respond `403` with code `market_forbidden` and MUST NOT return the other market’s rows.

Canonical fields MUST be:

| Resource | Canonical field |
|---|---|
| Customers | profile market (`hsr_market_country`) |
| Onboarding sessions, checkout CSV, onboarding metrics | `onboarding_user_state.market` |
| Billing subscriptions, production queue, coupons, webhooks, invoice PDF | `stripe_account` (`br`/`us`) |
| Catalog | plan country |
| Feedbacks | `country` |
| Privacy requests | `market` |
| Shipping settings | the BR or US settings document |

Customers without a profile market MUST appear only to admins. Nutrition simulate MUST reject a `country` outside the actor’s markets with `403 market_forbidden`.

#### Scenario: Operator BR lists only Brazil customers

- **WHEN** an operator assigned `BR` lists `GET /api/v1/admin/users`
- **THEN** every item has profile market `BR`, `total` counts only those rows, and US customers are absent

#### Scenario: Operator BR asking for US is forbidden

- **WHEN** an operator assigned `BR` lists catalog or onboarding with `market=US`, or billing/production with `account=us`
- **THEN** the system responds `403` with code `market_forbidden`

#### Scenario: Admin may filter one market

- **WHEN** an admin lists billing with `account=us`
- **THEN** the system returns only `stripe_account=us` rows

### Requirement: Record scope hides the other market with 404

For `record` routes, after loading the entity, if its canonical market is outside the actor’s markets, the system MUST respond `404` for GET and mutations. Invoice PDF MUST use only the ledger row’s `stripe_account` and MUST NOT probe the other Stripe account.

#### Scenario: Operator BR cannot open a US subscription

- **WHEN** an operator assigned `BR` `GET`s `/api/v1/admin/billing/subscriptions/:id` for a `stripe_account=us` row
- **THEN** the system responds `404`

#### Scenario: Operator BR cannot patch a US production item

- **WHEN** an operator assigned `BR` `PATCH`es `/api/v1/admin/production/queue/:id` for a US ledger row
- **THEN** the system responds `404` and the production status is unchanged

### Requirement: Nested customer payloads stay in the actor market

When returning a customer or onboarding detail, the system MUST include only nested billing, production, and shipment records whose canonical market is in the actor’s markets. When returning a billing or production item, identity fields MUST come from the ledger snapshot (email and address on the row), not a live profile join. The payload MUST indicate whether the linked customer profile is in the actor’s markets (`customerProfileInScope`).

#### Scenario: Brazil customer detail omits a US subscription

- **WHEN** an operator assigned `BR` opens a Brazil customer who also has a `stripe_account=us` subscription
- **THEN** the customer detail succeeds and the US subscription is absent from nested collections

#### Scenario: US subscription does not expose a Brazil profile as in-scope

- **WHEN** an operator assigned `US` loads that US subscription
- **THEN** `user.email` is the ledger `customer_email` and `customerProfileInScope` is false if the profile market is `BR`

### Requirement: Customer market is written once

On first successful persist of a customer address or checkout that yields `BR` or `US`, if profile market is empty, the system MUST store it. Later address updates MUST NOT change profile market. Changing a customer’s profile market MUST require an explicit admin action. Onboarding user state MUST set `market` when the state row is created, not on every address patch.

#### Scenario: First address stamps profile market

- **WHEN** a customer with empty profile market saves a Brazil address
- **THEN** profile market becomes `BR`

#### Scenario: Later address does not move the customer

- **WHEN** that customer later saves a United States address
- **THEN** profile market remains `BR`

### Requirement: Unassigned staff follow the enforcement flag

While `ADMIN_ENFORCE_STAFF_MARKET` is unset or false, a non-admin with no stored markets MUST retain unscoped access, and a non-admin with stored markets MUST already be scoped. While the flag is true, a non-admin with no stored markets MUST receive `403` with code `market_required` on `query` and `record` routes, and MUST still reach `none` routes.

#### Scenario: Flag off scopes assigned operators

- **WHEN** the flag is false and an operator assigned `BR` lists customers
- **THEN** only Brazil customers are returned

#### Scenario: Flag on blocks unassigned operators

- **WHEN** the flag is true and an operator has no stored markets
- **THEN** `GET /api/v1/admin/users` responds `403` with code `market_required` and `GET /api/v1/admin/me` still succeeds
