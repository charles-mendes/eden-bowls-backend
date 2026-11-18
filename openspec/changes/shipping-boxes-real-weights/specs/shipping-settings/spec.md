# Spec Delta

## MODIFIED Requirements

### Requirement: US boxes are editable settings

The US shipping settings MUST hold `boxes`: the `starter` and `monthly` boxes, each with `label`, `length_in`, `width_in`, `height_in`, `empty_weight_kg` and `max_packs`. On deploy they MUST be Starter 14 × 12 × 8 in, 0.355 kg, 10 packs, and monthly 18 × 14 × 12 in, 0.600 kg, 30 packs, the weights the client measured. An empty weight an operator already changed MUST stay as it is. `GET /api/v1/admin/shipping/settings` MUST return them and `PUT` MUST accept them with `shipping.write`. Dimensions MUST be above 0 and at most 108 in. Empty weight MUST be from 0.1 to 10 kg and MUST be stored to the gram (three decimals). `max_packs` MUST be a whole number from 1 to 100, and the Starter's MUST be lower than the monthly's. Otherwise the API MUST answer 422 `invalid_shipping_box` and MUST NOT store anything.

#### Scenario: Values after deploy

- **WHEN** the migration runs and the boxes still hold 1.0 kg and 1.5 kg
- **THEN** `us.boxes` holds the Starter at 0.355 kg and the monthly at 0.600 kg

#### Scenario: Weight changed before the deploy

- **WHEN** the migration runs and an operator had saved the monthly box at 0.8 kg
- **THEN** the monthly box stays at 0.8 kg and the Starter becomes 0.355 kg

#### Scenario: Operator records the weighed box

- **WHEN** an operator saves the monthly box `empty_weight_kg` 0.615
- **THEN** the settings return 0.615 and the next box plan weighs monthly boxes with 0.615 kg empty

#### Scenario: Starter not smaller than the monthly

- **WHEN** an operator saves the Starter `max_packs` 30 while the monthly is 30
- **THEN** the API answers 422 `invalid_shipping_box` and the stored settings are unchanged
