# shipping-settings Specification

## Purpose

Covers the per-market shipping settings that operators edit in the admin and that the API applies to quotes and delivery estimates without a deploy.

## Requirements

### Requirement: US maximum transit days is an editable setting

The US shipping settings MUST hold `max_transit_days`, an integer from 1 to 10, set to 1 on deploy. `GET /api/v1/admin/shipping/settings` MUST return it and `PUT /api/v1/admin/shipping/settings` MUST accept it with `shipping.write`; a value outside the range MUST be refused with HTTP 422 and the stored settings MUST stay unchanged. The delivery estimate, the delivery calendar impact and the customer deliveries MUST treat a US transit longer than the stored value as unavailable, in place of the fixed limit. A saved value MUST apply without restarting the API.

#### Scenario: Value after deploy

- **WHEN** the migration runs and a client requests a US delivery estimate with `transit_days=2`
- **THEN** the estimate is `available: false`, as before the deploy

#### Scenario: Operator allows two transit days

- **WHEN** an operator saves `max_transit_days` 2 and a client then requests a US estimate with `transit_days=2`
- **THEN** the estimate is available with its preparation day and delivery date

#### Scenario: Out of range

- **WHEN** an operator saves `max_transit_days` 0
- **THEN** the API returns 422 and the stored value is unchanged

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

The checkout quote and the admin simulation MUST use the US settings `package`. That quote MUST be the US shipping `original_amount`: the customer pays it only while `charge_shipping` is on, and otherwise it is kept as the company's shipping cost. On deploy, a `package` still at the old values (12 × 12 × 12 in, 10 lb) MUST become the monthly box at its full weight: 18 × 14 × 12 in and 37.5 lb. A `package` an operator already changed MUST stay as it is. The dry ice declaration MUST stay separate and MUST NOT be added again to that weight.

#### Scenario: Package at the old values

- **WHEN** the migration runs and the US `package` is 12 × 12 × 12 in and 10 lb
- **THEN** it becomes 18 × 14 × 12 in and 37.5 lb, and `dry_ice_kg` is unchanged

#### Scenario: Package edited before

- **WHEN** the migration runs and the US `package` weighs 25 lb
- **THEN** the `package` is unchanged

### Requirement: US shipping charges are a switch with a history

The US shipping settings MUST hold `charge_shipping`, a boolean, off on deploy. `GET /api/v1/admin/shipping/settings` MUST return it and `PUT /api/v1/admin/shipping/settings` MUST accept it from an operator with `shipping.write` on the US market, which includes a US-only operator; an operator without the US market MUST be refused as for the other US settings. A value other than a boolean MUST be refused with HTTP 422 `invalid_charge_shipping` and nothing stored. The value MUST be stored in the database and MUST survive a restart. Each save that changes it MUST be recorded in the admin audit log as `shipping.us.charge.enable` or `shipping.us.charge.disable`, with the actor, the market and the time, in the same transaction as the change: a change that cannot be audited MUST NOT be saved. A save that keeps the value MUST NOT add an event. The GET MUST return `us.charge_shipping_history`, newest first, up to 50 events, each with `enabled`, `actor_email` and `changed_at`. A saved value MUST apply to the next quote and checkout without restarting the API.

#### Scenario: Value after deploy

- **WHEN** the migration runs and an operator reads the shipping settings
- **THEN** `us.charge_shipping` is false and the history is empty

#### Scenario: US operator turns charges on

- **WHEN** a US-only operator with `shipping.write` saves `charge_shipping` true
- **THEN** the setting is true, one `shipping.us.charge.enable` event names that operator, and the next US quote reports `charge_enabled` true

#### Scenario: Brazil-only operator

- **WHEN** a Brazil-only operator saves `charge_shipping`
- **THEN** the API refuses it and the setting and history are unchanged

#### Scenario: Same value saved again

- **WHEN** `charge_shipping` is false and an operator saves the US rules with false
- **THEN** no event is added to the history

#### Scenario: Restart

- **WHEN** `charge_shipping` was turned on and the API restarts
- **THEN** the settings still report it on

