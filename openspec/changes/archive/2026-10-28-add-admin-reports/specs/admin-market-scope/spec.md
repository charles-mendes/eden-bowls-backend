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
| Reports (`/api/v1/admin/reports/*`) | the canonical field of each source above (`stripe_account` for invoices, subscriptions and production; `onboarding_user_state.market` for acquisition; item `market` for stock) |

Customers without a profile market MUST appear only to admins. Nutrition simulate MUST reject a `country` outside the actor’s markets with `403 market_forbidden`. Stock writes MUST reject a body `market` outside the actor’s markets with `403 market_forbidden`. Reports other than the summary MUST resolve to exactly one market and MUST respond `400` with code `report_market_required` when an actor with both markets omits it.

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

#### Scenario: Operator BR report stays in Brazil

- **WHEN** an operator assigned `BR` calls `GET /api/v1/admin/reports/revenue` without `market`
- **THEN** only `stripe_account=br` invoices are summed, and `GET /api/v1/admin/reports/revenue?market=US` responds `403` with code `market_forbidden`

### Requirement: Customer market is written once

On first successful persist of a customer address or checkout that yields `BR` or `US`, if profile market is empty, the system MUST store it. Later address updates MUST NOT change profile market. Changing a customer’s profile market MUST require an explicit admin action. Onboarding user state MUST set `market` from the first address that yields `BR` or `US`, whichever onboarding step created the row, and later address patches MUST NOT change it. Existing checkouts with an empty market MUST be filled from the customer's profile market when it is `BR` or `US`; the others stay empty.

#### Scenario: First address stamps profile market

- **WHEN** a customer with empty profile market saves a Brazil address
- **THEN** profile market becomes `BR`

#### Scenario: Later address does not move the customer

- **WHEN** that customer later saves a United States address
- **THEN** profile market remains `BR`

#### Scenario: Checkout row created before the address

- **WHEN** the recurrence step creates the checkout row without a market and the customer then saves a Brazil address
- **THEN** the checkout market becomes `BR`, and a later United States address keeps it `BR`
