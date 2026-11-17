# delivery-instructions Specification

## Purpose

Defines the delivery instructions of an address (gate, where to leave the box, care with the pet) in both markets: how they are collected at checkout, stored with the saved and subscription addresses, edited, and read by the people and carriers that deliver.

## Requirements

### Requirement: Delivery instructions have one validation rule

Delivery instructions MUST be optional. A value MUST be trimmed with every run of whitespace, line breaks included, collapsed to one space. After that it MUST have at most 200 characters, counted as Unicode code points (an emoji counts as one), and MUST NOT contain control characters. An empty result MUST mean "no instructions". Every route that writes instructions MUST use this rule: the checkout address, the profile delivery, the subscription edit, the admin profile instructions and the admin subscription instructions. A value that breaks the rule MUST be answered with HTTP 422, and nothing is saved:

- The profile delivery route MUST report it under `deliveryInstructions` in its `errors` map, like the other fields of that route.
- Every other route MUST report it with field `delivery_instructions`.
- On the subscription edit, the error MUST keep that field and MUST NOT come as `invalid_plan`.

#### Scenario: Normal text

- **WHEN** the instructions are "  Portão azul,\n  tocar interfone 12  "
- **THEN** they are stored as "Portão azul, tocar interfone 12"

#### Scenario: Too long

- **WHEN** the instructions have 201 characters after trimming
- **THEN** the API returns 422 with field `delivery_instructions` and the stored address is unchanged

#### Scenario: Only spaces

- **WHEN** the instructions are "   "
- **THEN** they are stored as no instructions

#### Scenario: Emoji counts as one character

- **WHEN** the instructions are 199 letters followed by "🐶"
- **THEN** they are accepted, because they have 200 code points

#### Scenario: Too long on the profile

- **WHEN** a customer saves the profile delivery with 201 characters of instructions
- **THEN** the API returns 422 `validation_error` with `errors.deliveryInstructions` and the profile address is unchanged

#### Scenario: Too long on the subscription edit

- **WHEN** a subscription edit sends 201 characters of instructions
- **THEN** the API returns 422 with field `delivery_instructions`, not `invalid_plan`, and nothing is saved

### Requirement: Checkout collects delivery instructions in both markets

The checkout address step MUST have an optional delivery instructions field for Brazil and United States addresses, with a counter for the 200-character limit. It MUST be pre-filled from the saved address when that address has instructions. The value MUST be sent as `delivery_instructions` in `POST /api/v1/onboarding/address`. A customer MUST be able to finish checkout without filling it.

#### Scenario: Brazil customer fills the field

- **WHEN** a Brazil customer types "Deixar na portaria" and saves the address step
- **THEN** the saved address holds "Deixar na portaria"

#### Scenario: US customer leaves it empty

- **WHEN** a US customer leaves the field empty and pays
- **THEN** the subscription starts and its address has no instructions

#### Scenario: Pre-filled from the profile

- **WHEN** a customer whose profile address holds "Interfone 12" reaches the address step
- **THEN** the field shows "Interfone 12" and can be changed or cleared

### Requirement: Saving the checkout address keeps omitted instructions

`POST /api/v1/onboarding/address` MUST keep the stored instructions when the request has no `delivery_instructions` field. An empty string MUST clear them. A value MUST replace them after the validation rule. Every other field MUST keep today's replace behavior.

#### Scenario: Older client without the field

- **WHEN** the saved address holds "Interfone 12" and the checkout address is saved without `delivery_instructions`
- **THEN** the saved address still holds "Interfone 12"

#### Scenario: Customer clears the field

- **WHEN** the same address is saved with `delivery_instructions: ""`
- **THEN** the saved address has no instructions

### Requirement: The subscription keeps the instructions of its checkout

Starting a subscription MUST copy the instructions of the saved address into the subscription address and into its checkout snapshot. Later edits to the profile or the saved address MUST NOT change the instructions of existing subscriptions.

#### Scenario: Gift with its own instructions

- **WHEN** a customer checks out with instructions "Casa da avó, portão verde" and later changes the profile instructions to "Interfone 12"
- **THEN** the subscription address still holds "Casa da avó, portão verde"

### Requirement: The customer can edit the instructions of a subscription

The subscription edit address step in the store MUST show and edit the subscription instructions. A subscription edit that sends an address without `delivery_instructions` MUST keep the stored instructions, an empty string MUST clear them, and a value MUST replace them after the validation rule. An instructions-only change MUST NOT invoice, move the renewal or call Stripe for a price change. It MUST change only that subscription.

#### Scenario: Street change without the field

- **WHEN** a customer changes the street of a subscription whose instructions are "Portão azul" and the request has no instructions field
- **THEN** the subscription address has the new street and still holds "Portão azul"

#### Scenario: Instructions change only

- **WHEN** a customer changes only the instructions of an active subscription to "Deixar com o porteiro"
- **THEN** that subscription's next delivery reads "Deixar com o porteiro", nothing is charged, and its other subscriptions and the profile address are unchanged

### Requirement: The operator can edit the instructions of a subscription

`PATCH /api/v1/admin/billing/subscriptions/:id/delivery-instructions` with `{ delivery_instructions }` MUST let a user with `users.delivery.write` in the subscription's market set or clear the instructions of that subscription. Only that key of that subscription address MUST change: not the profile address, Stripe, or another subscription. The value MUST follow the validation rule. The change MUST be audited as `billing.subscriptions.delivery_instructions.update` with the subscription and the actor, without the text itself. The answer MUST hold the stored `delivery_instructions`, or `null` when cleared. An unknown subscription and a subscription outside the operator's market MUST both answer 404.

#### Scenario: Operator fixes the gate

- **WHEN** a Brazil operator sends "Portão lateral" for a Brazil subscription
- **THEN** the subscription address holds "Portão lateral", the profile address is unchanged and an audit event is written without the text

#### Scenario: Other market

- **WHEN** an operator scoped to the United States sends instructions for a Brazil subscription
- **THEN** the API answers 404 and nothing is saved

#### Scenario: Missing permission

- **WHEN** a user without `users.delivery.write` calls the route
- **THEN** the API answers 403 and nothing is saved

### Requirement: The admin profile instructions follow the rule and are audited

`PATCH /api/v1/admin/users/:userId/delivery-instructions` MUST keep its body key `deliveryInstructions`. It MUST apply the validation rule and answer an invalid value with 422 and field `delivery_instructions`. It MUST write an audit event `users.delivery_instructions.update` with the actor and the customer, without the text. It MUST keep changing only the profile copy, never a subscription address.

#### Scenario: Profile instructions saved by an operator

- **WHEN** an operator saves "Deixar na portaria" for a customer
- **THEN** the profile address holds it, an audit event is written, and the customer's subscriptions keep their own instructions

### Requirement: Deliveries read the subscription instructions first

Every screen and API answer that shows instructions for a subscription delivery MUST use the instructions stored on the subscription address when there are any, with source `subscription`.

When the subscription has none, it MUST use the profile address instructions only when the profile describes the same place. Otherwise it MUST show none. Two places are the same when, after normalizing:

- in Brazil, the ZIP, the street and the number match;
- in the United States, the street line and the ZIP match;
- in both markets, the country matches.

Normalizing means: ZIP digits only (the first 5 for a US ZIP), and street and number trimmed, lowercased, with accents removed and whitespace collapsed.

The answer MUST report the source as `subscription` or `profile`, or carry `null` instructions with a `null` source. A later profile edit MUST NOT change the value stored on a subscription. Its effect through this fallback MUST stay limited to subscriptions at the same place. This covers the courier queue, the UPS label queue and the admin subscription detail.

#### Scenario: Subscription has its own

- **WHEN** the subscription address holds "Portão verde" and the profile holds "Interfone 12"
- **THEN** the delivery shows "Portão verde" with source `subscription`

#### Scenario: Old subscription at the profile address

- **WHEN** the subscription address has no instructions, is "Rua A, 10, 01310-100", and the profile is "rua  a, 10, 01310100" holding "Interfone 12"
- **THEN** the delivery shows "Interfone 12" with source `profile`

#### Scenario: Gift at another address without instructions

- **WHEN** the subscription address has no instructions, is "Rua B, 20, 04000-000", and the profile is "Rua A, 10, 01310-100" holding "Interfone 12"
- **THEN** the delivery shows no instructions and the source is `null`

#### Scenario: US street with a different ZIP+4

- **WHEN** the subscription address is "100 Main St, 10001-1234" with no instructions and the profile is "100 main st, 10001" holding "Leave at back door"
- **THEN** the delivery shows "Leave at back door" with source `profile`

### Requirement: UPS receives the ship-to phone and no free-text instructions until confirmed

A UPS label request MUST send the ship-to phone from the subscription address. When the address has none, it MUST send the account phone. The number MUST follow the UPS layout for a US ship-to: 10 digits (area code and 7-digit number), after removing a leading country code 1. A number that does not give 10 digits MUST NOT be sent. With no usable number, the request MUST send no phone, as today. A UPS label request MUST NOT send the delivery instructions in any field until a field for them is confirmed against the UPS Shipping API schema and accepted on CIE. The UPS rate request MUST NOT change.

#### Scenario: Phone from the account

- **WHEN** an operator buys a label for a US subscription whose address has no phone and whose account phone is "+1 (212) 555-0100"
- **THEN** the label request carries the ship-to phone "2125550100"

#### Scenario: Phone that does not fit the US layout

- **WHEN** the only phone on file is "+55 11 98888-7777"
- **THEN** the label request carries no ship-to phone

#### Scenario: Instructions are not sent

- **WHEN** the subscription address holds "Leave at back door"
- **THEN** the label request carries no copy of that text, and the label queue shows it to the operator

### Requirement: Instructions follow the privacy rules

Delivery instructions MUST be treated as personal data of the address they belong to. A privacy export MUST include them with that address. An erasure that clears an address MUST clear them too. Audit events and logs MUST NOT store their text.

#### Scenario: Erasure

- **WHEN** a customer's erasure request is carried out
- **THEN** no profile or subscription address of that customer keeps delivery instructions
