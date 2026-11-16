## MODIFIED Requirements

### Requirement: Saving data that passes closes the problem

When the customer saves a subscription address, or a CPF and fiscal name, every open problem of that account MUST be checked again, because the fiscal data belongs to the account. A problem with nothing left MUST close with `resolved_by: customer`. When an operator fills the recipient of a subscription in the panel, the open problem of that subscription MUST be checked again the same way and, with nothing left, MUST close with `resolved_by: operator`. A problem with codes left MUST stay open with only those codes, and MUST NOT send an email. Saving a new address MUST clear `courier_address_unusable`.

#### Scenario: Customer fixes the address

- **WHEN** the customer saves the address with the missing number
- **THEN** the problem closes, and the next dispatch of that cycle is allowed

#### Scenario: Save still incomplete

- **WHEN** a problem lists a missing number and a missing CPF, and the customer saves only the number
- **THEN** the problem stays open with only the CPF code and no email is sent

#### Scenario: Fiscal name saved on another subscription

- **WHEN** a customer with two Brazil subscriptions, each with a problem for the missing fiscal name, saves the fiscal name in one of them
- **THEN** both problems close

#### Scenario: Operator fills the recipient

- **WHEN** a problem lists only `recipient_name_missing` and an operator fills the recipient of that subscription
- **THEN** the problem closes with `resolved_by: operator` and no email is sent

#### Scenario: Operator fills the recipient with other codes left

- **WHEN** a problem lists `recipient_name_missing` and a missing number, and an operator fills the recipient
- **THEN** the problem stays open with only the missing number and no email is sent
