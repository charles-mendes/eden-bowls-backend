# Spec Delta

## MODIFIED Requirements

### Requirement: Report routes

The system SHALL expose `GET` routes under `/api/v1/admin/reports/`: `summary`, `revenue`, `subscriptions`, `acquisition`, `mix`, `operations`, `stock`, `export.csv`, `details` and `details/export.csv`. Every route MUST declare `marketScope` `query`. Report routes MUST NOT write any data. Every JSON response MUST include `market` (except `summary`), `currency` (except `summary`), `period`, and `generatedAt`.

#### Scenario: Routes are listed in the manifest

- **WHEN** `npm run routes:manifest` runs after the change
- **THEN** `docs/api-routes.json` lists the ten report routes as `GET`

#### Scenario: Report routes reject writes

- **WHEN** a caller sends `POST /api/v1/admin/reports/revenue`
- **THEN** the system responds `404` and nothing is written

### Requirement: CSV export

`export.csv` MUST take `report` (one of `summary`, `revenue`, `subscriptions`, `acquisition`, `mix`, `operations`, `stock`) plus the same `market`, `from`, `to` and `granularity` as the JSON report, and return the same figures the Relatórios tab shows, one row per figure. An unknown `report` MUST respond `400` with code `report_unknown`. The file name MUST be `eden-<report>-<market>-<from>-<to>.csv` (`all` as market for an admin summary of both markets).

The header MUST be `Aba`, `Seção`, `Item`, `Indicador`, `De`, `Até`, `Parcial`, `Valor`, `Unidade`, `Moeda`, `Período anterior`, `Anterior de`, `Anterior até`, `Variação`, `Unidade da variação`, `Observação`, `Chave`. Every report except `summary` MUST start with `Relatório` rows for market, currency, period, previous period, time zone, granularity and generation time (`mix` says its period is now). Labels and sections MUST be the Portuguese ones of the tab. Money MUST be a decimal amount with the `currency` column. Rates MUST be percentages rounded to one decimal. `Variação` MUST follow the screen: percent change for counts and money (empty when the previous value is zero or missing), percentage points for rates. Point-in-time figures MUST leave the previous columns empty and say `agora` in `Observação`. The tab's hints and warnings MUST be in `Observação` or in `Avisos` rows. Each series MUST have one row per bucket and measure followed by a `Total do período` row. `Chave` MUST hold the API field path of the figure.

#### Scenario: Revenue export matches the JSON

- **WHEN** an operator exports `report=revenue&market=BR` for a period
- **THEN** the CSV series has the same buckets and amounts as `GET /api/v1/admin/reports/revenue` for the same query

#### Scenario: Unknown report

- **WHEN** a caller asks for `report=customers`
- **THEN** the system responds `400` with code `report_unknown`

#### Scenario: Card with comparison

- **WHEN** BR gross revenue is `307741` and the previous period is `134496`
- **THEN** the `grossRevenue` row has `Indicador` `Faturamento bruto`, `Valor` `3077,41`, `Período anterior` `1344,96`, `Variação` `128,8` and `Unidade da variação` `%`

#### Scenario: Rate change in percentage points

- **WHEN** churn is `0.1` and was `0.05` in the previous period
- **THEN** the `churn` row has `Valor` `10`, `Unidade` `%`, `Variação` `5` and `Unidade da variação` `p.p.`

#### Scenario: Point-in-time card

- **WHEN** the subscriptions export has 2 subscriptions past due
- **THEN** the `current.pastDue` row has `Valor` `2`, empty previous columns and `Observação` `agora`

### Requirement: Reports carry no personal data

Aggregate report responses and the aggregate `export.csv` MUST contain only aggregates. They MUST NOT include customer names, e-mails, addresses, Stripe customer ids or subscription ids. Customer names MAY appear only in the per-indicator details, under the rules of the `admin-report-details` capability.

#### Scenario: Revenue export has no e-mail

- **WHEN** a revenue CSV is generated for a period with paid invoices
- **THEN** no column or cell contains a customer e-mail or name

#### Scenario: Details are the only place with a name

- **WHEN** an operator opens the details of `grossRevenue`
- **THEN** the details carry customer names, and `GET /api/v1/admin/reports/revenue` for the same query still carries none
