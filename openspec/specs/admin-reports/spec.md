# admin-reports Specification

## Purpose
Gives the admin panel read-only, aggregated reports of revenue, subscriptions, acquisition, delivery mix, operations and pack stock, computed per market (Brazil and United States) and per period, with a side-by-side market comparison and CSV export, under the same permission and market scope rules as every other admin route.

## Requirements

### Requirement: Report routes

The system SHALL expose `GET` routes under `/api/v1/admin/reports/`: `summary`, `revenue`, `subscriptions`, `acquisition`, `mix`, `operations`, `stock` and `export.csv`. Every route MUST declare `marketScope` `query`. Report routes MUST NOT write any data. Every JSON response MUST include `market` (except `summary`), `currency` (except `summary`), `period`, and `generatedAt`.

#### Scenario: Routes are listed in the manifest

- **WHEN** `npm run routes:manifest` runs after the change
- **THEN** `docs/api-routes.json` lists the eight report routes as `GET`

#### Scenario: Report routes reject writes

- **WHEN** a caller sends `POST /api/v1/admin/reports/revenue`
- **THEN** the system responds `404` and nothing is written

### Requirement: Report permissions

Reading any report MUST require permission `reports.read`. `export.csv` MUST additionally require `reports.export`. `reports.read` MUST be granted to `admin`, `operator` and `readonly`. `reports.export` MUST be granted to `admin` and `operator`. `veterinarian` MUST NOT receive either. `GET /api/v1/admin/me` MUST list the permissions the session has.

#### Scenario: Readonly reads but cannot export

- **WHEN** a `readonly` session assigned `BR` calls `GET /api/v1/admin/reports/revenue` and then `GET /api/v1/admin/reports/export.csv?report=revenue`
- **THEN** the first call responds `200` and the second responds `403`

#### Scenario: Veterinarian is forbidden

- **WHEN** a veterinarian-only session calls `GET /api/v1/admin/reports/summary`
- **THEN** the system responds `403`

#### Scenario: Session exposes the permissions

- **WHEN** an operator calls `GET /api/v1/admin/me`
- **THEN** `permissions` includes `reports.read` and `reports.export`

### Requirement: One market per report

Every report except `summary` MUST be computed for exactly one market, given as `market` `BR` or `US`. When `market` is absent and the actor has exactly one market, that market MUST be used. When `market` is absent and the actor has both, the system MUST respond `400` with code `report_market_required`. A market outside the actor's markets MUST respond `403` with code `market_forbidden`. Money from different markets MUST NOT be added together in any response.

#### Scenario: Single-market operator needs no parameter

- **WHEN** an operator assigned `US` calls `GET /api/v1/admin/reports/revenue` without `market`
- **THEN** the report is computed for `US` and `currency` is `USD`

#### Scenario: Admin must choose a market

- **WHEN** an admin calls `GET /api/v1/admin/reports/revenue` without `market`
- **THEN** the system responds `400` with code `report_market_required`

#### Scenario: Operator BR asks for US

- **WHEN** an operator assigned `BR` calls `GET /api/v1/admin/reports/subscriptions?market=US`
- **THEN** the system responds `403` with code `market_forbidden` and returns no US figures

### Requirement: Report period

Reports MUST accept `from` and `to` as `YYYY-MM-DD` dates in the market's local time zone (`BR` America/Sao_Paulo, `US` America/New_York), both inclusive. The default MUST be the 30 complete days ending yesterday. A `to` after today MUST be clamped to today. An invalid date, `from` after `to`, or a range over 366 days MUST respond `400` with code `report_period_invalid`. The response `period` MUST echo the applied `from`, `to`, `timezone` and the previous period of equal length.

#### Scenario: Default period

- **WHEN** a BR operator calls `GET /api/v1/admin/reports/revenue` on 2026-10-28 without dates
- **THEN** `period.from` is `2026-09-28`, `period.to` is `2026-10-27`, and `period.previous` is `2026-08-29` to `2026-09-27`

#### Scenario: Range too long

- **WHEN** a caller asks for `from=2025-01-01&to=2026-10-28`
- **THEN** the system responds `400` with code `report_period_invalid`

#### Scenario: Local day boundary

- **WHEN** a US invoice is issued at 2026-10-01 02:00 UTC and the US report asks for `from=2026-10-01`
- **THEN** that invoice is excluded, because it was issued on 2026-09-30 in America/New_York

### Requirement: A period ending today compares like with like

When `to` is today, the current period MUST end at the current time, the previous period MUST end at the same local time of day on its last day, and `period.partialToday` MUST be `true`. Otherwise `period.partialToday` MUST be `false`.

#### Scenario: Today is cut at the same hour

- **WHEN** a BR caller asks at 15:00 local for `from=2026-10-22&to=2026-10-28`
- **THEN** the current period ends 2026-10-28 15:00, the previous period ends 2026-10-21 15:00, and `partialToday` is `true`

### Requirement: Time series buckets

Reports with a series MUST accept `granularity` `day`, `week` or `month`. The default MUST be `day` for periods up to 31 days, `week` up to 120 days, and `month` above that. Weeks MUST start on Monday in the market time zone. Every bucket in the period MUST be present, with zero values when empty. A bucket cut by `from`, by `to` or by the current time MUST carry `partial: true`.

#### Scenario: Empty weeks are zero

- **WHEN** a 12-week revenue report has no paid invoice in the fifth week
- **THEN** the series has 12 buckets and the fifth has revenue `0` and invoice count `0`

#### Scenario: Edge months are partial

- **WHEN** a monthly report runs from `2026-03-15` to `2026-10-27`
- **THEN** the March and October buckets have `partial: true` and the months in between have `partial: false`

### Requirement: Comparison with the previous period

Each period KPI MUST return `value` and `previous`, where `previous` is the same measure for the previous period of equal length. Point-in-time measures (current subscription status counts, estimated recurring revenue, stock balance) MUST return `previous` as `null`.

#### Scenario: Revenue carries the previous period

- **WHEN** BR gross revenue was R$ 10.000,00 in the period and R$ 8.000,00 in the previous one
- **THEN** the gross revenue KPI has `value` `1000000` and `previous` `800000`, both in minor units

### Requirement: Revenue report

`revenue` MUST report gross revenue: the sum of `amount_paid_minor` of the market's customer invoices with status `paid` issued in the period, as charged (taxes and shipping included, refunds not deducted). It MUST also report the paid invoice count, the average ticket (gross revenue divided by paid invoices, `null` when zero), the split by first purchase (`subscription_create`) versus other billing reasons, and the series. Money MUST be integers in minor units with `currency` `BRL` or `USD`.

#### Scenario: Only paid invoices count

- **WHEN** the period has two paid BR invoices of R$ 150,00 and one open invoice of R$ 200,00
- **THEN** gross revenue is `30000`, paid invoices is `2`, and the average ticket is `15000`

### Requirement: Invoices in another currency are excluded

Revenue MUST only sum invoices whose currency matches the market account (`br` with BRL, `us` with USD). Invoices of the market account in any other currency MUST be left out of every sum and counted in `excludedInvoices`, and the system MUST log a warning with their count.

#### Scenario: A USD invoice on the Brazil account

- **WHEN** the BR period has one paid invoice in USD on the `br` account
- **THEN** that invoice is not in gross revenue and `excludedInvoices` is `1`

### Requirement: Estimated recurring revenue

`revenue` MUST also return `estimatedMrr`: the sum, over the market's subscriptions in status `active` or `past_due`, of each subscription's stored plan price normalized to one month. Trialing subscriptions MUST be left out and counted in `trialingSubscriptions`. Subscriptions without a stored price MUST be left out and counted in `unpricedSubscriptions`. The field MUST carry `estimated: true`.

#### Scenario: Subscription without a price snapshot

- **WHEN** one active US subscription has no stored plan price
- **THEN** `estimatedMrr` excludes it and `unpricedSubscriptions` is `1`

#### Scenario: Trialing stays out

- **WHEN** a BR subscription is `trialing`
- **THEN** its price is not in `estimatedMrr` and `trialingSubscriptions` counts it

### Requirement: Subscription activation date is recorded

The subscription ledger SHALL store `activated_at`, the first time the subscription reached `active`, `trialing` or `past_due`. Once set it MUST NOT change. A subscription that never reached those statuses (including Stripe `incomplete` and `incomplete_expired`) MUST keep it empty.

#### Scenario: Expired checkout never activates

- **WHEN** a subscription goes from `incomplete` to Stripe `incomplete_expired`, stored as `canceled`
- **THEN** `activated_at` stays empty

#### Scenario: First activation is kept

- **WHEN** a subscription becomes `active` on 2026-10-01, `past_due` on 2026-11-01, and `active` again on 2026-11-03
- **THEN** `activated_at` is 2026-10-01

### Requirement: Subscription cancellation date is recorded

The ledger SHALL store `canceled_at`, the time the subscription actually ended. It MUST be set only when the stored status becomes `canceled`, from Stripe's `ended_at`, falling back to `canceled_at`. A cancellation request with `cancel_at_period_end` MUST NOT set it. Once set on a `canceled` row it MUST NOT change.

#### Scenario: Cancellation requested before the period end

- **WHEN** a customer asks to cancel on 2026-10-10 with `cancel_at_period_end`, and the subscription ends on 2026-11-10
- **THEN** `canceled_at` stays empty in October and is 2026-11-10 once the `customer.subscription.deleted` event arrives

#### Scenario: Customer withdraws the cancellation

- **WHEN** a customer asks to cancel on 2026-10-10 and reverts it on 2026-10-15
- **THEN** `canceled_at` stays empty and the subscription is not counted as canceled in any period

#### Scenario: Later update keeps the date

- **WHEN** a later webhook updates a row that was canceled on 2026-10-10 14:00 UTC
- **THEN** `canceled_at` is still 2026-10-10 14:00 UTC

### Requirement: Existing rows are backfilled

The migration MUST fill `activated_at` with `created_at` for rows currently `active`, `trialing`, `past_due` or `paused`, and for `canceled` rows with at least one paid customer invoice or charged invoice. It MUST fill `canceled_at` with `updated_at` for `canceled` rows that have `activated_at`. Every backfilled date MUST be marked approximate.

#### Scenario: Old canceled row without payment

- **WHEN** a pre-existing `canceled` row has no paid or charged invoice
- **THEN** `activated_at` and `canceled_at` stay empty and the row never counts as new or canceled

### Requirement: Subscriptions report

`subscriptions` MUST return the current counts of active, trialing, canceling, past due and renewing in the next 7 days. For the period it MUST return new subscriptions (`activated_at` in the period), canceled subscriptions (`canceled_at` in the period, among rows with `activated_at`) and a series of new and canceled per bucket. Rows without `activated_at` MUST NOT count as new or canceled.

#### Scenario: Cancellation counts by end date

- **WHEN** a subscription ended on 2026-09-02 and its row was updated by a webhook on 2026-10-20
- **THEN** a report for October does not count it as canceled

#### Scenario: Never-paid checkout is not new

- **WHEN** a subscription was created in the period and expired as `incomplete_expired`
- **THEN** it counts neither as new nor as canceled

### Requirement: Churn uses subscriptions active at the start

Subscriptions active at the start MUST be the rows with `activated_at` before the period start and with `canceled_at` empty or at or after the period start. Churn MUST be the number of those rows canceled in the period divided by that count (`null` when the count is zero). Subscriptions that started and ended inside the period MUST count in `canceled` but MUST NOT count in the churn numerator.

#### Scenario: Started and ended inside the period

- **WHEN** 100 subscriptions are active at the start, 4 of them cancel in the period, and 1 subscription activates and cancels inside the period
- **THEN** `activeAtStart` is `100`, `canceled` is `5`, and churn is `0.04`

### Requirement: Approximate dates are flagged

Rows whose activation or cancellation date was backfilled MUST still count by that date. The subscriptions report MUST return `approximateCanceledCount` and `approximateNewCount` with how many of the period's cancellations and new subscriptions use an approximate date.

#### Scenario: Backfilled row is flagged

- **WHEN** one of the period's five cancellations has a backfilled date
- **THEN** canceled is `5` and `approximateCanceledCount` is `1`

### Requirement: Acquisition report

`acquisition` MUST count the market's checkouts created in the period (stage 1), those of them linked to at least one Stripe subscription (stage 2), and those whose subscription reached activation (stage 3, `activated_at` set). It MUST return the conversion rate between consecutive stages (`null` when the earlier stage is zero) and a series of stage 1 per bucket. Stage 3 MUST NOT depend on whether the subscription is still active today.

#### Scenario: Funnel conversion

- **WHEN** the period has 200 checkouts, 120 linked and 90 activated
- **THEN** stages are `200`, `120`, `90` and conversions are `0.6` and `0.75`

#### Scenario: Later cancellation does not shrink the funnel

- **WHEN** a checkout from the previous period activated and was canceled afterwards
- **THEN** it still counts in stage 3 of the previous period

### Requirement: Checkouts without a market stay visible to admins

The acquisition report MUST count checkouts by `onboarding_user_state.market` only, with no fallback in the report, so it matches the Checkouts list and the onboarding metrics. For an admin it MUST also return `unassignedCheckouts`: the checkouts created in the period with an empty market. For any other role the field MUST be absent.

#### Scenario: Admin sees unassigned checkouts

- **WHEN** an admin requests the BR acquisition report and one checkout of the period has no market
- **THEN** that checkout is not in stage 1 and `unassignedCheckouts` is `1`

#### Scenario: Operator does not see the field

- **WHEN** an operator assigned `BR` requests the acquisition report
- **THEN** the response has no `unassignedCheckouts`

### Requirement: Mix report

`mix` MUST aggregate, over the market's subscriptions in status `active`, `trialing` or `past_due`, the packs per recipe (sum of line item quantities per cycle) and the subscriptions and packs per pack size, one row per pack size in grams. Recipe names MUST be the market's catalog name. The mix is point-in-time and MUST ignore `from` and `to`, echoing `period` as `null`.

#### Scenario: Recipes in the market language

- **WHEN** the US mix is requested
- **THEN** recipe names are the US catalog names and pack sizes are labelled in the US format

### Requirement: Recipes without a catalog name are flagged

A recipe of the mix or stock report with no catalog name in the market MUST still be listed, with its key as `name` and `nameMissing: true`. The CSV MUST write it as `<key> (sem nome no catálogo <Brasil|EUA>)`. Recipes with a name MUST have `nameMissing: false`.

#### Scenario: Brazil recipe key in a US subscription

- **WHEN** a US subscription has a line item `bovino` and the US catalog has no name for it
- **THEN** the mix lists `bovino` with `nameMissing: true`, and the CSV item is `bovino (sem nome no catálogo EUA)`

### Requirement: Pack sizes keep their grams

Pack sizes MUST NOT be merged by label. US labels MUST show ounces followed by the grams, as `17.6 oz (499 g)`. Brazil labels MUST show grams only, as `300 g`.

#### Scenario: Two sizes with the same ounces

- **WHEN** US subscriptions use 499 g and 500 g packs
- **THEN** the mix has two rows, `17.6 oz (499 g)` and `17.6 oz (500 g)`

### Requirement: Operations report

`operations` MUST count the market's paid production cycles whose delivery date falls in the period, by production status: `to_prepare`, `in_production`, `ready`, `blocked`. Every paid cycle MUST be in exactly one of them. Renewals still waiting for payment (`awaiting_payment` or `past_due` in the production queue) have no delivery date yet: they MUST NOT be in the status counts and MUST be returned apart as `awaitingPayment`, the current count, with `previous` `null`.

#### Scenario: Unpaid renewal is not a cycle yet

- **WHEN** a BR subscription's next renewal is not paid yet
- **THEN** it is not in the status counts and counts in `awaitingPayment`

### Requirement: Late cycles

A paid cycle MUST count as late when its preparation day is before today in the market time zone and its status is not `ready`. A late cycle MUST still count under its own status. A renewal waiting for payment MUST NOT count as late.

#### Scenario: Late cycle

- **WHEN** a BR cycle had preparation day 2026-10-20 and is still `in_production` on 2026-10-28 in America/Sao_Paulo
- **THEN** it counts as `in_production` and as late

#### Scenario: Unpaid renewal is never late

- **WHEN** a BR renewal is past due and has not been paid
- **THEN** it counts in `awaitingPayment` and not in `late`

### Requirement: UPS shipments in the operations report

For `US`, `operations` MUST count UPS shipments created in the period by shipment status, and leave voided shipments out of the total. For `BR` the shipment block MUST be `null`.

#### Scenario: Brazil has no UPS block

- **WHEN** the BR operations report is requested
- **THEN** `shipments` is `null`

### Requirement: Stock report

`stock` MUST return, per recipe and pack size of the market, the packs produced, separated (net of separation reversals) and adjusted in the period, and the current balance and minimum level. Totals MUST be the sum of those rows.

#### Scenario: Separation reversal nets out

- **WHEN** 40 packs were separated and 5 reversed in the period for `BR / frango / 300`
- **THEN** that row shows separated `35`

### Requirement: Market comparison summary

`summary` MUST return one block per market in the actor's markets, in the order `BR`, `US`, each with its own `currency` and the period KPIs: gross revenue, paid invoices, average ticket, active subscriptions, new, canceled, churn, checkouts started and checkout-to-activation conversion. An optional `market` MUST restrict the blocks to that market under the same `market_forbidden` rule. Dates MUST be applied in each market's own time zone.

#### Scenario: Admin sees both markets side by side

- **WHEN** an admin calls `GET /api/v1/admin/reports/summary`
- **THEN** `markets` has a `BR` block in `BRL` and a `US` block in `USD`, and no field sums both

#### Scenario: Operator sees only their market

- **WHEN** an operator assigned `BR` calls `GET /api/v1/admin/reports/summary`
- **THEN** `markets` has only the `BR` block

### Requirement: CSV export

`export.csv` MUST take `report` (one of `summary`, `revenue`, `subscriptions`, `acquisition`, `mix`, `operations`, `stock`) plus the same `market`, `from`, `to` and `granularity` as the JSON report, and return the same figures with a header row. An unknown `report` MUST respond `400` with code `report_unknown`. Money MUST be a decimal amount plus a `currency` column. The file name MUST be `eden-<report>-<market>-<from>-<to>.csv` (`all` as market for an admin summary of both markets).

#### Scenario: Revenue export matches the JSON

- **WHEN** an operator exports `report=revenue&market=BR` for a period
- **THEN** the CSV series has the same buckets and amounts as `GET /api/v1/admin/reports/revenue` for the same query

#### Scenario: Unknown report

- **WHEN** a caller asks for `report=customers`
- **THEN** the system responds `400` with code `report_unknown`

### Requirement: CSV opens in Excel set to Portuguese

`export.csv` MUST accept `formato` `excel` (default) or `csv`. `excel` MUST start with a UTF-8 BOM, separate fields with `;` and use a comma as the decimal separator, whatever the market. `csv` MUST be plain UTF-8 without a BOM, separated by `,` with a dot as the decimal separator. Any other `formato` MUST respond `400` with code `report_format_invalid`.

#### Scenario: Default export for Excel

- **WHEN** an operator exports US revenue of `1234567` minor units without `formato`
- **THEN** the file starts with the UTF-8 BOM, the row uses `;`, and the amount cell is `12345,67` with currency `USD`

#### Scenario: Machine format

- **WHEN** a caller exports with `formato=csv`
- **THEN** there is no BOM, fields use `,`, and the amount cell is `12345.67`

### Requirement: CSV text cells are safe from formula injection

Every text cell whose value starts with `=`, `+`, `-`, `@`, a tab or a carriage return MUST be written with a leading `'`. Numeric cells MUST NOT be altered, so negative numbers stay numbers.

#### Scenario: Recipe name starting with an equals sign

- **WHEN** a recipe presentation name is `=HYPERLINK("x")`
- **THEN** the stock CSV cell is `'=HYPERLINK("x")`, and an adjustment of `-3` is still written as `-3`

### Requirement: Slow reports are stopped

Each report query MUST be limited to 10 seconds of execution in the database. When the limit is hit, the query MUST be aborted on the database side and the system MUST respond `503` with code `report_timeout`.

#### Scenario: Heavy query times out

- **WHEN** the revenue query runs for more than 10 seconds
- **THEN** the database stops the query and the caller receives `503` with code `report_timeout`

### Requirement: Reports carry no personal data

Report responses and CSV files MUST contain only aggregates. They MUST NOT include customer names, e-mails, addresses, Stripe customer ids or subscription ids.

#### Scenario: Revenue export has no e-mail

- **WHEN** a revenue CSV is generated for a period with paid invoices
- **THEN** no column or cell contains a customer e-mail or name
