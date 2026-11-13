# Spec Delta

## MODIFIED Requirements

### Requirement: The queue shows enough to choose

Each order MUST show the customer name, city, ZIP, production status, subscription status, delivery date, and the delivery instructions with their source (`subscription` or `profile`) when there are any. Neither status MUST hide an order. Buying a selection that includes an order whose production status is not `ready`, or whose subscription is not `active` or `trialing`, MUST require a second confirmation that names those orders.

#### Scenario: Food still in preparation

- **WHEN** a paid US cycle is `to_prepare` and has a complete address
- **THEN** the queue lists it with that status and asks for the extra confirmation before buying

#### Scenario: Paused subscription with a paid cycle

- **WHEN** a paused subscription has a paid cycle without a label
- **THEN** the queue lists it with the paused status and asks for the extra confirmation before buying

#### Scenario: Order with instructions

- **WHEN** a paid US cycle's subscription address holds "Leave at back door"
- **THEN** the queue shows "Leave at back door" with source `subscription` for that order
