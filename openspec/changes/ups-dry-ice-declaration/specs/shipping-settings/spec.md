## ADDED Requirements

### Requirement: US dry ice weight per box is an editable setting

The US shipping settings MUST hold `package.dry_ice_kg`, the dry ice weight in each box in kilograms, set to 0.5 on deploy. `GET /api/v1/admin/shipping/settings` MUST return it and `PUT /api/v1/admin/shipping/settings` MUST accept it with `shipping.write`. A value below 0.1, above 2.5, with more than one decimal place, or heavier than the package weight MUST be refused with HTTP 422 and the stored settings MUST stay unchanged. A saved value MUST apply to the next UPS request without restarting the API.

#### Scenario: Value after deploy

- **WHEN** the migration runs and an operator reads the shipping settings
- **THEN** the US package shows `dry_ice_kg` 0.5

#### Scenario: Operator changes the weight

- **WHEN** an operator saves `dry_ice_kg` 1.2
- **THEN** the next UPS label and quote declare 1.2 kg of dry ice

#### Scenario: Above the limit

- **WHEN** an operator saves `dry_ice_kg` 3
- **THEN** the API returns 422 and the stored value is unchanged

#### Scenario: Zero is refused

- **WHEN** an operator saves `dry_ice_kg` 0
- **THEN** the API returns 422 and the stored value is unchanged

#### Scenario: Two decimal places

- **WHEN** an operator saves `dry_ice_kg` 0.55
- **THEN** the API returns 422 and the stored value is unchanged

#### Scenario: Heavier than the package

- **WHEN** the package weight is 1 lb and an operator saves `dry_ice_kg` 0.5
- **THEN** the API returns 422, because 0.5 kg is more than 1 lb, and the stored settings are unchanged
