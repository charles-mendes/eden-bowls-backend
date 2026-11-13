## Purpose

Covers how the API declares the dry ice packed in each US box to UPS, so labels and quotes describe the shipment as UN1845 dry ice under the US ground rules.

## ADDED Requirements

### Requirement: Labels declare the dry ice

Every UPS label request for a US shipment MUST declare dry ice on its package, with regulation set `CFR`, the stored `dry_ice_kg` as the weight, and kilograms as the unit. The weight MUST be sent with one decimal place. The request MUST NOT mark the dry ice as medical use. The service code MUST stay the one chosen from `allowed_service_codes`.

#### Scenario: Label with the deploy value

- **WHEN** an operator buys a label and `dry_ice_kg` is 0.5
- **THEN** the UPS label request declares 0.5 kg of dry ice under `CFR` on the package, with service `03`

#### Scenario: UPS refuses the declaration

- **WHEN** UPS rejects the label request because of the dry ice declaration
- **THEN** no label is stored and the operator sees the UPS error, as with any other refused label

### Requirement: Quotes declare the dry ice

Every UPS rate request, both the US checkout quote and the admin shipping simulation, MUST declare the same dry ice as the label, so that a dry ice surcharge returned by UPS is part of the quoted amount.

#### Scenario: Checkout quote

- **WHEN** `quote_mode` is `ups` and a customer requests a US shipping quote
- **THEN** the UPS rate request declares the stored dry ice weight under `CFR`, and the amount shown is the amount UPS returns

#### Scenario: Admin simulation

- **WHEN** an operator runs the US shipping simulation
- **THEN** the UPS rate request, with and without transit time, declares the same dry ice
