## MODIFIED Requirements

### Requirement: Blocked orders show why

An order that fails a label check MUST show the reason and MUST NOT be selectable. The checks MUST be the same ones a single purchase uses: market exception, country, P.O. Box, APO/FPO/DPO military address, incomplete address, missing ship-from, and missing recipient name.

#### Scenario: P.O. Box

- **WHEN** a US order has a P.O. Box address
- **THEN** the queue lists the order with that reason and it cannot be selected

#### Scenario: Military address

- **WHEN** a US order's city is APO, FPO, or DPO
- **THEN** the queue and a single purchase both refuse it with the military address reason

#### Scenario: Crossed subscription

- **WHEN** a single purchase is asked for a subscription with account `us` and address country `BR`
- **THEN** the API returns 422 with code `shipment_market_exception` and no label is bought

## ADDED Requirements

### Requirement: The label queue lists only the US market

The UPS label queue MUST include a paid cycle only when its subscription's shipping market is US: account `us` and address country `US`.

#### Scenario: US account with a Brazil address

- **WHEN** a subscription with account `us` and address country `BR` has a paid cycle
- **THEN** the label queue does not list it, and it appears only in the market exceptions list
