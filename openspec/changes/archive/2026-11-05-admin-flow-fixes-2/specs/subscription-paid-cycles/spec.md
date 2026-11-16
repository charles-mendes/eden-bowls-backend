## Purpose

Defines the list of paid cycles of one subscription that the admin uses to ship from the subscription detail, without calling Stripe.

## ADDED Requirements

### Requirement: A subscription lists its paid cycles with their shipping state

`GET /api/v1/admin/billing/subscriptions/:id/paid-cycles` MUST return the subscription's paid cycles from the same source as the production, label and courier queues, newest delivery first, up to 24. Each cycle MUST carry the paid invoice id, preparation day, production status, delivery date, and its shipping state: the active UPS shipment (status, tracking number) or the latest courier delivery (status, dates), or none. It MUST NOT call Stripe and MUST NOT list unpaid invoices or invoices with no cycle. It MUST require `shipping.read` and the subscription's market.

#### Scenario: Cycle to ship

- **WHEN** a subscription has a paid cycle marked ready with no label and no courier delivery
- **THEN** the list returns that cycle with production `ready` and no shipping state

#### Scenario: Old zero-value invoice

- **WHEN** the subscription has a paid zero-value invoice with no production cycle
- **THEN** it does not appear in the list

#### Scenario: Other market

- **WHEN** a Brazil-only operator asks for a US subscription
- **THEN** the API refuses it as the other subscription routes do
