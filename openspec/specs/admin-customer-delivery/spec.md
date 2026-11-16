# admin-customer-delivery Specification

## Purpose

Defines how the admin API records an operator's correction of the delivery address copy kept in a customer's profile, which does not change where a subscription box goes.

## Requirements

### Requirement: Profile delivery correction is audited with its reason

A successful `PATCH /api/v1/admin/users/:userId/delivery` MUST write an audit event `users.delivery.update` with the actor, the customer and the names of the address fields sent. It MUST accept an optional `reason` of 3 to 255 characters after trimming and store it in that event. A `reason` outside that length MUST be refused with `422` before anything is saved. The `reason` MUST NOT be stored in the address.

#### Scenario: Correction with a reason

- **WHEN** an operator saves a customer's address with `reason: "Cliente pediu por telefone"`
- **THEN** the profile address is saved and a `users.delivery.update` audit event carries the reason and the sent field names

#### Scenario: Reason too short

- **WHEN** the body carries `reason: "x"`
- **THEN** the response is `422` and the profile address does not change

#### Scenario: Subscription address untouched

- **WHEN** the profile address is corrected
- **THEN** the subscription address used by labels and couriers does not change
