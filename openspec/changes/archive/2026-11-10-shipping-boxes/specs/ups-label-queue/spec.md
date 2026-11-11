## ADDED Requirements

### Requirement: A label ships one package per box

Buying a UPS label for a paid cycle MUST create one UPS shipment with one package per box of the cycle's box plan. Each package MUST carry its box dimensions, its weight in pounds and the dry ice declaration. The shipment MUST store each package with its sequence, box key, pack count, weight, tracking number and label. The shipment's tracking number MUST be the first package's. A cycle with an empty box plan MUST use the settings `package` as one package, as before this change. The invoice MUST still have one active shipment.

#### Scenario: Two boxes

- **WHEN** an operator buys the label of a US cycle with 45 packs
- **THEN** UPS is called once with two packages, the shipment stores two packages with their tracking numbers and labels, and the invoice has one active shipment

#### Scenario: Cycle without sized packs

- **WHEN** an operator buys the label of a cycle whose lines have no pack size
- **THEN** the shipment has one package with the settings `package`

### Requirement: Each package label prints

`GET /api/v1/admin/shipments/:id/label` MUST return the first package's label, and with `?package=N` the label of package N. A package that does not exist MUST answer 404 `label_not_found`. The shipment returned to the admin MUST list its `packages` with `sequence`, `box_key`, `pack_count`, `weight_lb`, `tracking_number` and `has_label`. Voiding a shipment MUST void all its packages at UPS with one request.

#### Scenario: Second box label

- **WHEN** an operator opens `/admin/shipments/9/label?package=2` for a shipment with two packages
- **THEN** the API returns the second package's label

#### Scenario: Package out of range

- **WHEN** an operator asks for `?package=3` on a shipment with two packages
- **THEN** the API answers 404 `label_not_found`
