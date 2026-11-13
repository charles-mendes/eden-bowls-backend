## ADDED Requirements

### Requirement: A failed delivery records what kind of failure it was

Marking a delivery as failed MUST accept an optional `failure_kind` of `address_unusable`, `customer_absent` or `other`, beside the required free-text reason. Any other value MUST answer `422 invalid_courier_field` with field `failure_kind`, and nothing changes. The kind MUST be returned with the delivery and recorded in the `courier_delivery.failed` audit event. A failure without a kind MUST keep working as before.

#### Scenario: Address does not work

- **WHEN** an operator marks a delivery on the road as failed with `failure_kind: "address_unusable"` and reason "Portaria não aceita entrega"
- **THEN** the delivery is failed, carries both the kind and the reason, and the audit event names the kind

#### Scenario: Unknown kind

- **WHEN** the body carries `failure_kind: "lost"`
- **THEN** the API returns 422 with field `failure_kind` and the delivery stays on the road

#### Scenario: Older client

- **WHEN** the body carries only the reason
- **THEN** the delivery is failed with no kind

### Requirement: Queue rows carry what the dispatch needs

Each queue row MUST also carry the subscription delivery address (street, number, complement, neighborhood, city, state, ZIP), the account phone, the delivery instructions kept in the customer's profile address, and the cycle's flavors and packs as the production queue shows them. Missing values MUST come as `null` (or an empty list for items). The row MUST say that the instructions come from the profile. These fields MUST follow the route's permission and market scope and MUST NOT appear anywhere else.

#### Scenario: Complete row

- **WHEN** a paid Brazil cycle has a full address, the account has phone "+55 11 98888-7777" and the profile holds instructions "Interfone 12"
- **THEN** its row carries the full address, that phone, those instructions marked as from the profile, and the cycle's flavors and packs

#### Scenario: No phone

- **WHEN** the account has no phone
- **THEN** the row carries `phone: null` and the rest as usual
