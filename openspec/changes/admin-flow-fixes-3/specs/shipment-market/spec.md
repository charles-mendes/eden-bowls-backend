## Purpose

Decides, with one rule for every reader, which market ships a subscription's boxes, and lists the subscriptions that fit no market so operations can resolve them before anything leaves or is invoiced.

## ADDED Requirements

### Requirement: One rule decides the shipping market

A subscription's shipping market MUST be BR when its Stripe account is `br` and its delivery address country is `BR`, and US when its account is `us` and its address country is `US`. Any other pair, including an address without a country, MUST be a market exception with no shipping market. Billing MUST stay with the Stripe account.

#### Scenario: Brazil pair

- **WHEN** a subscription has account `br` and address country `BR`
- **THEN** its shipping market is BR

#### Scenario: Crossed pair

- **WHEN** a subscription has account `us` and address country `BR`
- **THEN** it is a market exception and has no shipping market

#### Scenario: No country

- **WHEN** a subscription's address has no country
- **THEN** it is a market exception

### Requirement: A market exception never ships or gets an NF-e

A market exception MUST NOT be listed in the courier queue or the UPS label queue, MUST be refused by a courier dispatch and a label purchase, and MUST NOT get an NF-e row when its invoice is paid. The payment itself MUST be processed as before.

#### Scenario: Crossed subscription pays

- **WHEN** a paid invoice arrives for a subscription with account `br` and address country `US`
- **THEN** no NF-e row is written, the production cycle is recorded as today, and the reason is logged

#### Scenario: Dispatch of a crossed subscription

- **WHEN** an operator dispatches a courier delivery for a subscription with account `us` and address country `BR`
- **THEN** the API returns 422 with code `shipment_market_exception`

### Requirement: The commercial invoice language follows the account

The Eden Bowls invoice MUST be in pt-BR for account `br` and in en-US for account `us`, whatever the address country.

#### Scenario: US account with a Brazil address

- **WHEN** the invoice of a subscription with account `us` and address country `BR` is issued
- **THEN** it is in en-US

### Requirement: Market exceptions are listed for the panel

`GET /api/v1/admin/market-exceptions` MUST list every subscription that is not canceled and is a market exception, with its account, address country, customer, and how many paid cycles of the last 30 days have no courier delivery on the road or delivered and no created or delivered label. It MUST need `shipping.read`. A staff member scoped to markets MUST see only subscriptions whose account is in their markets.

#### Scenario: Admin lists exceptions

- **WHEN** an admin calls the route and one active subscription has account `br` and address country `US`
- **THEN** the response lists it with `stripe_account: "br"`, `address_country: "US"` and its open paid cycles

#### Scenario: Staff limited to the US

- **WHEN** a staff member scoped to the US calls the route and the only exception has account `br`
- **THEN** the response is empty

#### Scenario: No permission

- **WHEN** a caller without `shipping.read` calls the route
- **THEN** the API returns 403

### Requirement: The admin subscription detail states its market

`GET /api/v1/admin/billing/subscriptions/:id` MUST return `shipment_market` (`BR`, `US` or `null`) and `market_exception` (true when the subscription fits no market).

#### Scenario: Crossed subscription detail

- **WHEN** the admin opens a subscription with account `us` and address country `BR`
- **THEN** the response has `shipment_market: null` and `market_exception: true`
