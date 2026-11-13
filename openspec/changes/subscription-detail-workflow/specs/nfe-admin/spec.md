# Spec Delta

## ADDED Requirements

### Requirement: The subscription NF-e list says what to fix

Each item of `GET /api/v1/admin/billing/subscriptions/:id/nfe` MUST carry `stripe_invoice_id`, `missing_fields` and `bling_problems`, with the same values and rules as the note detail. `bling_problems` MUST be empty once the note is no longer refused. The route keeps its permission and market checks.

#### Scenario: Note blocked for a missing fiscal name

- **WHEN** the admin lists the NF-e of a subscription whose note is blocked for a missing fiscal name
- **THEN** the item has `missing_fields: ["fiscal_name"]` and its `stripe_invoice_id`

#### Scenario: Note refused by Bling

- **WHEN** Bling refused the last attempt and named the fields it rejected
- **THEN** the item's `bling_problems` lists those fields, as the note detail does

#### Scenario: Authorized note

- **WHEN** the note is authorized
- **THEN** the item has empty `missing_fields` and empty `bling_problems`
