## ADDED Requirements

### Requirement: A subscription address edit needs a recipient

A subscription edit that sends an address MUST be refused with HTTP 422 and code `recipient_name_required` when neither the request nor the stored address has a valid recipient name. An edit without an address MUST NOT be affected.

#### Scenario: Old subscription changes its street

- **WHEN** a customer of a subscription stored without a recipient sends a new street and no recipient
- **THEN** the API returns 422 `recipient_name_required` and nothing is saved

#### Scenario: Pack change on an old subscription

- **WHEN** the same customer changes only packs for one delivery
- **THEN** the edit is saved as today

## MODIFIED Requirements

### Requirement: Tax documents keep the buyer

The NF-e and the Eden Bowls invoice MUST keep naming the buyer and MUST NOT use the recipient name. The NF-e MUST use the fiscal name, and a customer without one MUST have the note blocked. The Eden Bowls invoice MUST use the name it uses today (fiscal name or account name).

#### Scenario: NF-e of a gift

- **WHEN** the NF-e is issued for a subscription whose recipient differs from the buyer
- **THEN** the NF-e names the buyer

#### Scenario: Buyer without a fiscal name

- **WHEN** a BR customer has no fiscal name and their cycle is paid
- **THEN** the NF-e is blocked instead of naming the account display name
