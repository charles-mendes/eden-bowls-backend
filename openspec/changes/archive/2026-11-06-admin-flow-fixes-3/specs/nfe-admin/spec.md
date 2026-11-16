## ADDED Requirements

### Requirement: The NF-e uses the subscription address

A new NF-e row MUST copy the delivery address of the subscription of its invoice, not the customer's checkout state. The customer's name on the note MUST be the fiscal name.

#### Scenario: Address changed in the store

- **WHEN** a customer changed the subscription address in the store and the next cycle is paid
- **THEN** the new NF-e row carries the new subscription address

### Requirement: A note without a fiscal name is blocked

A note MUST be `blocked_missing_document` when the customer has no valid CPF or CNPJ or no valid fiscal name, and MUST list what is missing in `missing_fields` (`tax_document`, `fiscal_name`). The account display name MUST NOT stand in for the fiscal name.

#### Scenario: CPF without fiscal name

- **WHEN** a paid BR invoice belongs to a customer with a valid CPF and no fiscal name
- **THEN** the row is `blocked_missing_document` with `missing_fields: ["fiscal_name"]` and Bling is not called

### Requirement: Emission reads the customer again

Before generating, the job MUST copy into a note not yet authorized the current subscription address, CPF and fiscal name, unless an operator corrected the note's customer data. A note reached by an operator retry MUST do the same, whether or not it already has a Bling contact.

#### Scenario: Pending note after an address edit

- **WHEN** a note is pending with the old address and the customer saved a new subscription address before the job ran
- **THEN** the job sends the note with the new address

#### Scenario: Operator correction kept

- **WHEN** an operator corrected the note's address with "Corrigir dados"
- **THEN** the job keeps the operator's address

### Requirement: The Bling contact follows the note

When the Bling contact found by the document differs from the note's name or address, the job MUST update that contact before creating the order. When the note already exists in Bling in an editable state and its contact differs, the job MUST apply the note's name and address to it.

#### Scenario: Customer moved

- **WHEN** a customer with an existing Bling contact moved and a new note is emitted
- **THEN** the contact gets the new address before the order is created, and the note leaves with the new address

### Requirement: Saving fiscal data requeues blocked notes

When the customer saves a valid CPF and fiscal name, every `blocked_missing_document` note of that customer not corrected by an operator MUST read the customer again and return to the job queue when nothing is missing anymore.

#### Scenario: Customer fills the fiscal name

- **WHEN** a note is blocked with `missing_fields: ["fiscal_name"]` and the customer saves a fiscal name in the store
- **THEN** the note becomes pending and the job emits it on its next run

### Requirement: The NF-e detail shows what is missing

`GET /api/v1/admin/nfe/:id` MUST return `missing_fields` and the subscription's `address_issue`.

#### Scenario: Blocked note detail

- **WHEN** the admin opens a note blocked for a missing fiscal name
- **THEN** the response has `missing_fields: ["fiscal_name"]` and the open problem with its email state
