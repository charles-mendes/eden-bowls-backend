# Spec Delta

## MODIFIED Requirements

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
| Pack stock items, stock movements, stock overview | item `market` |

Customers without a profile market MUST appear only to admins. Nutrition simulate MUST reject a `country` outside the actor’s markets with `403 market_forbidden`. Stock writes MUST reject a body `market` outside the actor’s markets with `403 market_forbidden`.

#### Scenario: Operator BR lists only Brazil customers

- **WHEN** an operator assigned `BR` lists `GET /api/v1/admin/users`
- **THEN** every item has profile market `BR`, `total` counts only those rows, and US customers are absent

#### Scenario: Operator BR asking for US is forbidden

- **WHEN** an operator assigned `BR` lists catalog or onboarding with `market=US`, or billing/production with `account=us`
- **THEN** the system responds `403` with code `market_forbidden`

#### Scenario: Admin may filter one market

- **WHEN** an admin lists billing with `account=us`
- **THEN** the system returns only `stripe_account=us` rows

#### Scenario: Operator BR cannot move US stock

- **WHEN** an operator assigned `BR` records production or an adjustment with `market` `US`, or lists stock with `market=US`
- **THEN** the system responds `403` with code `market_forbidden` and no movement is written
