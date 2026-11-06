# ups-pickup Specification

## Purpose

Lets staff ask UPS to collect the day's US boxes from the kitchen, record the confirmation number, and know which labels each pickup covers.

## Requirements

### Requirement: Staff request a UPS pickup for created labels

`POST /admin/shipments/pickups` with `shipping.write` MUST request an on-demand pickup from UPS for `pickup_date`, between `ready_time` and `close_time`, for `package_count` boxes at the US ship-from address, and MUST store it as `requested` with the UPS confirmation number (PRN), linking every label in `shipment_ids` to it.

#### Scenario: Monday with eight boxes

- **WHEN** an operator requests a pickup for today, 14:00 to 18:00, 8 boxes, with the 8 labels created today
- **THEN** UPS is called once, the pickup is stored as `requested` with its PRN, and the 8 labels point to it

#### Scenario: Tuesday with no box

- **WHEN** no label is created on a day
- **THEN** nothing asks UPS for a pickup on that day

#### Scenario: Count differs from the labels

- **WHEN** an operator sends 15 labels and a package count of 14
- **THEN** the pickup is requested for 14 boxes and the 15 labels are linked

### Requirement: Only created US labels without an active pickup join a pickup

Every id in `shipment_ids` MUST be a US label with status `created`, with no tracking scan yet (`in_transit_at` and `out_for_delivery_at` empty) and no active pickup (`pending`, `requested` or `unknown`), within the actor's market scope. Otherwise the request MUST be refused with HTTP 422 and code `pickup_shipment_not_eligible`, listing the ids, and UPS MUST NOT be called. An empty list MUST be refused with `pickup_shipments_required`.

#### Scenario: Label already in a pickup

- **WHEN** one of the ids already belongs to a `requested` pickup
- **THEN** the API returns 422 `pickup_shipment_not_eligible` naming it, and UPS is not called

#### Scenario: Voided label

- **WHEN** one of the ids is a `voided` label
- **THEN** the API returns 422 `pickup_shipment_not_eligible`

#### Scenario: Box already scanned

- **WHEN** one of the ids is a created label that UPS already scanned in transit
- **THEN** the API returns 422 `pickup_shipment_not_eligible`, because the box already left

#### Scenario: Label from yesterday

- **WHEN** a label created yesterday has no pickup
- **THEN** it can join today's pickup

### Requirement: The pickup day and window are checked before UPS is called

`pickup_date` MUST be today or the next pickup day in New York: a weekday without `closesPickup` in the US delivery calendar. `ready_time` and `close_time` MUST be `HH:MM`, with `close_time` after `ready_time`, and `package_count` MUST be a whole number from 1. A refusal MUST answer HTTP 422 with code `pickup_date_not_allowed`, `pickup_window_invalid` or `pickup_count_invalid`, and MUST NOT call UPS.

#### Scenario: Closed day

- **WHEN** the US calendar has `closesPickup` on the date sent
- **THEN** the API returns 422 `pickup_date_not_allowed`

#### Scenario: Weekend

- **WHEN** the date sent is a Saturday
- **THEN** the API returns 422 `pickup_date_not_allowed`

#### Scenario: Two days ahead

- **WHEN** today is Monday and the date sent is Wednesday
- **THEN** the API returns 422 `pickup_date_not_allowed`

#### Scenario: Window backwards

- **WHEN** `ready_time` is 18:00 and `close_time` is 14:00
- **THEN** the API returns 422 `pickup_window_invalid`

### Requirement: The pickup uses the ship-from address and phone

The pickup MUST use the US `ship_from` address of the shipping settings and its `phone`, which MUST have at least 10 digits. When the street, city, state or ZIP is missing, or the phone is missing or shorter, the request MUST be refused with HTTP 422, code `pickup_ship_from_incomplete` and `missing` listing the fields (`street`, `city`, `state`, `zipcode`, `phone`), and UPS MUST NOT be called. The US shipping settings MUST accept and return `ship_from.phone`.

#### Scenario: No phone

- **WHEN** `ship_from.phone` is empty
- **THEN** the API returns 422 `pickup_ship_from_incomplete` with `missing` `["phone"]`

#### Scenario: Phone too short

- **WHEN** `ship_from.phone` is "555 0100"
- **THEN** the API returns 422 `pickup_ship_from_incomplete` with `missing` `["phone"]`

#### Scenario: Phone saved

- **WHEN** an admin saves the US shipping settings with `ship_from.phone` "305 555 0100"
- **THEN** reading the settings returns that phone

### Requirement: A pickup without a UPS answer stays open

When the UPS call times out or fails on the network, the pickup MUST be stored as `unknown` with its labels linked, and the API MUST answer HTTP 502 with code `pickup_unconfirmed`. A UPS refusal MUST store nothing and answer HTTP 502 with code `ups_upstream_error` and the UPS message. A pickup still `pending` 5 minutes after it was reserved (the process stopped between the reservation and the UPS answer) MUST be shown as `unknown` everywhere: in the list, in the label queue and to the close route. `POST /admin/shipments/pickups/:id/not-created` with `shipping.write` MUST close an `unknown` pickup as `not_created` and release its labels, without calling UPS. A pickup `pending` for less than 5 minutes MUST be refused with HTTP 409 and code `pickup_not_unknown`, because its UPS call may still answer.

#### Scenario: Timeout

- **WHEN** UPS does not answer the pickup request in time
- **THEN** the pickup is `unknown`, its labels stay linked and cannot join another pickup

#### Scenario: Checked on the UPS portal

- **WHEN** an operator closes an `unknown` pickup as not created
- **THEN** it becomes `not_created` and its labels are free again

#### Scenario: Reservation left behind

- **WHEN** a pickup has been `pending` for 10 minutes
- **THEN** the list shows it as `unknown`, and closing it as not created frees its labels

#### Scenario: Request in progress

- **WHEN** an operator closes as not created a pickup reserved 30 seconds ago and still `pending`
- **THEN** the API returns 409 `pickup_not_unknown`

#### Scenario: UPS refuses

- **WHEN** UPS answers with an error for the address
- **THEN** no pickup is stored and the labels stay free

### Requirement: Canceling a pickup goes through UPS

`POST /admin/shipments/pickups/:id/cancel` with `shipping.write` MUST cancel a `requested` pickup at UPS by its PRN, then mark it `canceled` and release its labels. A pickup that is not `requested` MUST be refused with HTTP 409 and code `pickup_not_cancelable`. When UPS refuses the cancel, the pickup MUST stay `requested` and the API MUST answer HTTP 502 with the UPS message.

#### Scenario: Canceled

- **WHEN** an operator cancels a requested pickup
- **THEN** UPS is called with its PRN, the pickup is `canceled` and its labels are free

#### Scenario: Already canceled

- **WHEN** an operator cancels a canceled pickup
- **THEN** the API returns 409 `pickup_not_cancelable` and UPS is not called

### Requirement: Staff list the pickups

`GET /admin/shipments/pickups` with `shipping.read` MUST list the pickups from `from` (default: 7 days ago in New York), newest date first, a request still in progress as `pending`, each with `id`, `pickup_date`, `ready_time`, `close_time`, `package_count`, `status`, `prn`, `shipment_ids` and who requested it. An actor without the US market MUST get an empty list.

#### Scenario: This week

- **WHEN** an operator opens the pickups after requesting Monday's and Wednesday's
- **THEN** both are listed, Wednesday first, with their PRN and labels

#### Scenario: Brazil operator

- **WHEN** a Brazil-only operator reads the pickups
- **THEN** the list is empty

### Requirement: Every pickup action is audited and permission checked

Requesting, canceling and closing a pickup MUST record an audit entry with the actor and the pickup. Staff without `shipping.write` MUST get HTTP 403 on those routes, and the simulation-only UPS client MUST refuse them with HTTP 409 and code `ups_simulation_only`.

#### Scenario: Read-only staff

- **WHEN** a read-only user requests a pickup
- **THEN** the API returns 403 and UPS is not called
