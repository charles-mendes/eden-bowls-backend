## ADDED Requirements

### Requirement: US boxes are editable settings

The US shipping settings MUST hold `boxes`: the `starter` and `monthly` boxes, each with `label`, `length_in`, `width_in`, `height_in`, `empty_weight_kg` and `max_packs`. On deploy they MUST be Starter 14 × 12 × 8 in, 1.0 kg, 10 packs, and monthly 18 × 14 × 12 in, 1.5 kg, 30 packs. `GET /api/v1/admin/shipping/settings` MUST return them and `PUT` MUST accept them with `shipping.write`. Dimensions MUST be above 0 and at most 108 in. Empty weight MUST be from 0.1 to 10 kg. `max_packs` MUST be a whole number from 1 to 100, and the Starter's MUST be lower than the monthly's. Otherwise the API MUST answer 422 `invalid_shipping_box` and MUST NOT store anything.

#### Scenario: Values after deploy

- **WHEN** the migration runs and an operator reads the shipping settings
- **THEN** `us.boxes` holds the Starter and monthly boxes with the client's measures

#### Scenario: Operator records the weighed box

- **WHEN** an operator saves the monthly box `empty_weight_kg` 1.7
- **THEN** the next box plan weighs monthly boxes with 1.7 kg empty

#### Scenario: Starter not smaller than the monthly

- **WHEN** an operator saves the Starter `max_packs` 30 while the monthly is 30
- **THEN** the API answers 422 `invalid_shipping_box` and the stored settings are unchanged

### Requirement: Checkout quote package starts as the monthly box

While free shipping is open with the client, the checkout quote and the admin simulation keep using the US settings `package`. On deploy, a `package` still at the old values (12 × 12 × 12 in, 10 lb) MUST become the monthly box at its full weight: 18 × 14 × 12 in and 37.5 lb. A `package` an operator already changed MUST stay as it is. The dry ice declaration MUST stay separate and MUST NOT be added again to that weight.

#### Scenario: Package at the old values

- **WHEN** the migration runs and the US `package` is 12 × 12 × 12 in and 10 lb
- **THEN** it becomes 18 × 14 × 12 in and 37.5 lb, and `dry_ice_kg` is unchanged

#### Scenario: Package edited before

- **WHEN** the migration runs and the US `package` weighs 25 lb
- **THEN** the `package` is unchanged
