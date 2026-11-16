## ADDED Requirements

### Requirement: Buying a label for an order that is not ready needs confirmation

Buying a UPS label for a paid invoice MUST answer `409 ups_label_needs_confirmation` with the list of reasons when the cycle's production status is not `ready` (`production_not_ready`) or the subscription is not active (`subscription_not_active`), unless the request carries `confirm_not_ready: true`. The reasons and codes MUST be the same as the courier dispatch. Nothing MUST be bought or stored before the confirmation. An address or settings problem that refuses the purchase (422) MUST answer before the confirmation, so the operator is never asked to confirm a purchase that would be refused. An invoice that already holds an active shipment MUST keep answering as today, with no confirmation, because nothing is bought. A confirmed purchase MUST record the confirmed reasons in its audit event.

#### Scenario: Order still being prepared

- **WHEN** an operator buys a label for a paid invoice whose cycle is `in_production`, without confirmation
- **THEN** the API returns 409 with reason `production_not_ready` and no shipment row exists

#### Scenario: Confirmed

- **WHEN** the same request carries `confirm_not_ready: true`
- **THEN** the label is bought and the audit event lists `production_not_ready`

#### Scenario: Ready order

- **WHEN** the cycle is `ready` and the subscription active
- **THEN** the label is bought without confirmation

#### Scenario: Bad address and not ready

- **WHEN** the cycle is not ready and the shipping address is incomplete
- **THEN** the API returns the 422 for the address, not the 409

#### Scenario: Shipment already active

- **WHEN** the invoice already has a created label and the cycle is not ready
- **THEN** the API returns the existing shipment as today, without asking for confirmation
