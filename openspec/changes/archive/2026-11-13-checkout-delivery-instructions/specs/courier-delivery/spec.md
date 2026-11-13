# Spec Delta

## MODIFIED Requirements

### Requirement: Queue rows carry what the dispatch needs

Each queue row MUST also carry the subscription delivery address (street, number, complement, neighborhood, city, state, ZIP), the account phone, the delivery instructions, and the cycle's flavors and packs as the production queue shows them. The instructions MUST come from the subscription address. When it has none, they MUST come from the customer's profile address only when the profile describes the same place, by the rule in `delivery-instructions`. Otherwise the row MUST carry none. The row MUST carry `delivery_instructions_source` as `subscription` or `profile`, or `null` when neither has instructions. Missing values MUST come as `null` (or an empty list for items). These fields MUST follow the route's permission and market scope and MUST NOT appear anywhere else.

#### Scenario: Complete row

- **WHEN** a paid Brazil cycle has a full address with instructions "Portão verde", the account has phone "+55 11 98888-7777" and the profile holds instructions "Interfone 12"
- **THEN** its row carries the full address, that phone, "Portão verde" with source `subscription`, and the cycle's flavors and packs

#### Scenario: Instructions only in the profile, same place

- **WHEN** the subscription address has no instructions and is the same place as the profile, which holds "Interfone 12"
- **THEN** the row carries "Interfone 12" with source `profile`

#### Scenario: Gift at another place

- **WHEN** the subscription address has no instructions and is another place than the profile, which holds "Interfone 12"
- **THEN** the row carries `delivery_instructions: null` and `delivery_instructions_source: null`

#### Scenario: No instructions

- **WHEN** neither the subscription nor the profile has instructions
- **THEN** the row carries `delivery_instructions: null` and `delivery_instructions_source: null`

#### Scenario: No phone

- **WHEN** the account has no phone
- **THEN** the row carries `phone: null` and the rest as usual
