# subscription-contract Specification

## Purpose

Defines what a subscription contract is, how its deliveries are counted, and what starts or ends one, so that plan-end dates, automatic endings, and notices agree.

## Requirements

### Requirement: Deliveries count toward the current contract

A contract MUST contain as many charged deliveries as its term in months. Only deliveries charged since the current contract started MUST count toward it. The total charged over the subscription's life MUST stay stored unchanged.

#### Scenario: First contract

- **WHEN** a three-month plan has 2 charged deliveries and no term change
- **THEN** its contract has 1 delivery left

#### Scenario: Renewal rolls into the next contract

- **WHEN** a three-month plan with renewal on has 3 charged deliveries and the next delivery is charged
- **THEN** a new contract is running with 2 deliveries left

### Requirement: A term change starts a new contract

Saving a different term MUST start a new contract with the full new term, counted from the next charge. Deliveries already charged MUST NOT reduce it. Saving the same term MUST NOT start a contract. An edit waiting for payment MUST start the contract only when that payment is confirmed.

#### Scenario: One month to three

- **WHEN** a one-month plan with 1 charged delivery changes to three months
- **THEN** the plan has 3 deliveries left

#### Scenario: Three months to six

- **WHEN** a three-month plan with 3 charged deliveries changes to six months
- **THEN** the plan has 6 deliveries left

#### Scenario: Four charged, then six

- **WHEN** a plan with 4 charged deliveries changes to six months
- **THEN** the plan has 6 deliveries left

#### Scenario: Shorter term

- **WHEN** a six-month plan with 2 charged deliveries changes to three months
- **THEN** the plan has 3 deliveries left

#### Scenario: Other edit

- **WHEN** a customer changes recipes and keeps the term
- **THEN** the count of the current contract does not change

#### Scenario: Edit waiting for payment

- **WHEN** a term change is pending payment
- **THEN** the current contract stays as it was until the invoice is paid, and then the new contract starts

### Requirement: Term change and a scheduled end

A term change on a plan ending because renewal was turned off MUST remove the scheduled end, so the new contract runs. Renewal MUST stay off, and the plan MUST end after the new contract's last delivery. A plan cancelled explicitly MUST stay cancelled.

#### Scenario: Renewal off after the last charge

- **WHEN** a plan with renewal off and a scheduled end changes to three months
- **THEN** the scheduled end is removed, 3 deliveries remain, and the end is scheduled again when the third is charged

#### Scenario: Explicit cancellation

- **WHEN** a plan cancelled by the customer changes term
- **THEN** the scheduled end stays

### Requirement: Contracting more

While a plan is active, the customer MUST extend it by changing the term or keeping renewal on, in the same subscription. After a plan has ended, contracting MUST create a new subscription. A pet covered by a live subscription MUST NOT enter a second one.

#### Scenario: A year of contracts for one dog

- **WHEN** a dog has contracts of 1, 3, 1, and 6 months in a row through term changes
- **THEN** each contract delivers its full term in the same subscription

#### Scenario: Buying again after the end

- **WHEN** a plan has ended and the customer contracts for the same dog
- **THEN** a new subscription is created with its own count

### Requirement: Edit shows what is due now

The review of a plan edit MUST show only the adjustment the edit itself creates, as a charge or a credit. The next regular invoice MUST NOT be presented as due now. Saving MUST invoice at once only when that adjustment is a charge.

#### Scenario: Term change alone

- **WHEN** a customer changes only the term
- **THEN** the review shows nothing due now, and saving creates no charge

#### Scenario: More packs

- **WHEN** an edit adds a pack mid-period and the adjustment is R$ 44,85
- **THEN** the review shows R$ 44,85 due now, not the next invoice plus that amount

#### Scenario: Fewer packs

- **WHEN** an edit removes a pack mid-period and the adjustment is a credit of R$ 44,84
- **THEN** the review shows the credit and no charge

### Requirement: An edit that needs card confirmation waits for it

When the invoice of an edit needs the customer to confirm the payment, the save MUST return its client secret and hold the edit as pending. A paid invoice MUST NOT hold the edit.

#### Scenario: Card requires authentication

- **WHEN** the edit's invoice is open and carries a confirmation secret
- **THEN** the store receives the secret and the edit stays pending until the invoice is paid

#### Scenario: Paid at once

- **WHEN** the edit's invoice is already paid
- **THEN** the edit applies without waiting

### Requirement: Edit review states the new contract

When an edit changes the term, the review MUST state that a new contract of that term starts at the next charge. It MUST NOT say that the billing cycle restarts. The next charge date MUST NOT change because of the term.

#### Scenario: Review of a term change

- **WHEN** a customer reviews a change to six months
- **THEN** the review states that a six-month contract starts at the next charge

#### Scenario: Next charge date

- **WHEN** a term change is saved
- **THEN** the next charge date is the same as before

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
