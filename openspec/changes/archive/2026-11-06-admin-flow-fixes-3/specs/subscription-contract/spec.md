## ADDED Requirements

### Requirement: Checkout and edit need a complete address

Starting a subscription at checkout and a subscription edit that sends an address MUST be refused with HTTP 422 and code `address_incomplete`, listing the missing fields, when the address lacks the street, city, state or postal code. A Brazil address MUST also need the number and neighborhood. Each field MUST accept the aliases already stored (`street`, `line1`, `address_line1`; `zipcode`, `postal_code`).

#### Scenario: Brazil edit without a neighborhood

- **WHEN** a customer of account `br` sends an address with no neighborhood
- **THEN** the API returns 422 `address_incomplete` listing `neighborhood`, and nothing is saved

#### Scenario: US checkout without a street

- **WHEN** a checkout for the US has no street in its address
- **THEN** the API returns 422 `address_incomplete` and Stripe is not called

#### Scenario: Address stored with aliases

- **WHEN** an edit sends `line1` and `postal_code` instead of `street` and `zipcode`
- **THEN** the address counts as complete

#### Scenario: Onboarding session check unchanged

- **WHEN** the onboarding session is checked before payment with only country, CEP, state and city
- **THEN** it still passes `session_incomplete` as today, and only the checkout start refuses the incomplete address

### Requirement: An edit never changes the country

A subscription edit whose address country differs from the account market MUST be refused with HTTP 422 and code `address_country_mismatch`. An address without a country MUST take the account market.

#### Scenario: US address on a Brazil subscription

- **WHEN** a customer of account `br` sends an address with country `US`
- **THEN** the API returns 422 `address_country_mismatch` and nothing is saved

### Requirement: A crossed subscription cannot edit its address

When the stored address country differs from the account market, an edit that sends an address MUST be refused with HTTP 422 and code `subscription_market_mismatch`. An edit without an address MUST be saved as today.

#### Scenario: Stored Brazil address on a US account

- **WHEN** a customer of a subscription with account `us` and stored country `BR` sends any address
- **THEN** the API returns 422 `subscription_market_mismatch`

### Requirement: The edit accepts the CPF and fiscal name

A subscription edit of account `br` MUST accept `tax_document` and `fiscal_name` with the checkout validation, and MUST save them for the account after the edit is saved. An invalid value MUST be refused with 422 and the checkout codes. Account `us` MUST refuse both fields with 422 and code `fiscal_fields_not_allowed`.

#### Scenario: Customer adds the fiscal name

- **WHEN** a customer of account `br` saves an edit with `fiscal_name: "Maria Souza"`
- **THEN** the account's fiscal name is "Maria Souza" for every subscription of that account

#### Scenario: Invalid CPF

- **WHEN** the edit sends `tax_document: "111.111.111-11"`
- **THEN** the API returns 422 and nothing is saved

### Requirement: The store detail says what fiscal data is missing

`GET /api/v1/subscriptions/:id/detail` of account `br` MUST return `fiscal` with the last 4 digits of the CPF or `null`, the fiscal name or `null`, and `missing` listing `tax_document` and `fiscal_name` when absent. Every detail MUST return `market_mismatch`, true when the stored address country differs from the account market.

#### Scenario: Customer without fiscal name

- **WHEN** a customer with a CPF ending in 1234 and no fiscal name opens the detail
- **THEN** the response has `fiscal: { tax_document_last4: "1234", fiscal_name: null, missing: ["fiscal_name"] }`

#### Scenario: Crossed subscription detail

- **WHEN** a customer opens the detail of a subscription with account `us` and stored country `BR`
- **THEN** the response has `market_mismatch: true`
