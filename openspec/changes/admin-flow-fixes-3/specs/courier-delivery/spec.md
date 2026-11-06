## MODIFIED Requirements

### Requirement: Only a paid Brazil delivery can get a courier record

A courier delivery MUST belong to one subscription invoice. The invoice MUST be paid, MUST belong to that subscription, and MUST be a charged delivery: a first or cycle invoice whose subtotal is above zero. The subscription's shipping market MUST be BR: Stripe account `br` and delivery address country `BR`. Any other invoice MUST be refused with HTTP 422 and no record is stored.

#### Scenario: Paid Brazil cycle

- **WHEN** an operator registers a delivery for a paid cycle invoice of a subscription with account `br` delivered in Brazil
- **THEN** the record is stored as out for delivery

#### Scenario: US subscription

- **WHEN** an operator registers a courier delivery for a subscription with account `us` whose delivery address is in the US
- **THEN** the API returns 422 with code `courier_country_not_supported`

#### Scenario: Crossed subscription

- **WHEN** an operator registers a courier delivery for a subscription with account `us` whose delivery address is in Brazil
- **THEN** the API returns 422 with code `shipment_market_exception`

#### Scenario: Skipped cycle

- **WHEN** the invoice is paid with a subtotal of zero
- **THEN** the API returns 422 with code `invoice_not_delivery`

#### Scenario: Unpaid invoice

- **WHEN** the invoice is open
- **THEN** the API returns 422 with code `invoice_not_paid`

## ADDED Requirements

### Requirement: The courier queue lists only the Brazil market

The courier queue and the Today count of Brazil boxes to dispatch MUST include a paid cycle only when its subscription's shipping market is BR.

#### Scenario: Crossed cycle

- **WHEN** a subscription with account `us` and address country `BR` has a paid cycle
- **THEN** the courier queue does not list it and the Today count does not count it

### Requirement: A dispatch needs a complete Brazil address

A dispatch MUST be refused with HTTP 422 and code `courier_address_incomplete` when the subscription address lacks the street, number, neighborhood, city, state, an 8-digit CEP or the recipient name. The response MUST list the failing codes in `issues`. `confirm_not_ready` MUST NOT bypass it.

#### Scenario: No neighborhood

- **WHEN** an operator dispatches a cycle whose address has no neighborhood, with `confirm_not_ready: true`
- **THEN** the API returns 422 `courier_address_incomplete` with `issues` containing `address_neighborhood_missing`, and nothing is stored

#### Scenario: Complete address

- **WHEN** the address has every field and a recipient name
- **THEN** the dispatch follows the usual readiness rule

### Requirement: Queue rows show what the address lacks

Each row under to dispatch and failed MUST carry `issues`, the codes the dispatch check would refuse, empty when the address passes.

#### Scenario: Row without a number

- **WHEN** a to-dispatch cycle's address has no number
- **THEN** its row has `issues: ["address_number_missing"]`
