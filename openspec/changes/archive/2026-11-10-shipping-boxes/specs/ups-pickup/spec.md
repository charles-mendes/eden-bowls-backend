## ADDED Requirements

### Requirement: Pickup weight is the sum of its packages

A pickup request MUST send UPS the total weight of the packages of the labels in `shipment_ids`, in pounds, in place of the settings package weight times the box count. A label without stored packages MUST count as one settings `package`.

#### Scenario: Two labels with three boxes

- **WHEN** an operator requests a pickup for two labels, one with packages of 37.5 lb and 20.2 lb and one with a package of 9.9 lb
- **THEN** UPS receives a total weight of 67.6 lb
