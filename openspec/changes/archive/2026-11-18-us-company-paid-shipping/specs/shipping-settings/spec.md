# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Checkout quote package starts as the monthly box

The checkout quote and the admin simulation MUST use the US settings `package`. That quote MUST be the US shipping `original_amount`: the customer pays it only while `charge_shipping` is on, and otherwise it is kept as the company's shipping cost. On deploy, a `package` still at the old values (12 × 12 × 12 in, 10 lb) MUST become the monthly box at its full weight: 18 × 14 × 12 in and 37.5 lb. A `package` an operator already changed MUST stay as it is. The dry ice declaration MUST stay separate and MUST NOT be added again to that weight.

#### Scenario: Package at the old values

- **WHEN** the migration runs and the US `package` is 12 × 12 × 12 in and 10 lb
- **THEN** it becomes 18 × 14 × 12 in and 37.5 lb, and `dry_ice_kg` is unchanged

#### Scenario: Package edited before

- **WHEN** the migration runs and the US `package` weighs 25 lb
- **THEN** the `package` is unchanged
