# delivery-tracking Specification

## Purpose

Defines the delivery stages a UPS shipment reaches, the date each stage is first reached, and how the customer sees them in the store.

## Requirements

### Requirement: Stages come from the UPS scan

A tracking read MUST map each UPS activity to a stage. Delivered MUST come from a delivery scan or a delivery date of type `DEL`, never from a scheduled date of type `SDD`. Out for delivery MUST come from the scan code (`OF`, status `072`, and the codes confirmed in the UPS catalog), with the English description only as a fallback. Pickup and transit scans MUST map to in transit.

#### Scenario: Out for delivery uses the UPS scan code

- **WHEN** the latest activity has type `I`, code `OF`, status code `072`, description "Loaded on Delivery Vehicle", and the delivery date type is `SDD`
- **THEN** out for delivery is reached and the shipment is not delivered

#### Scenario: Scheduled date only

- **WHEN** a read in transit carries a delivery date of type `SDD`
- **THEN** the shipment is not delivered

### Requirement: Stage dates are kept from the first time

A shipment MUST store the date it first reached each of four stages: label created, in transit, out for delivery, and delivered. Label created is the purchase time. The other three MUST use the date and time of the earliest UPS scan of that stage found in the read, as UPS sends it, with no time zone conversion. A later read MUST NOT change a stored date. A stage passed with no scan in any read MUST count as reached with no date.

#### Scenario: Normal progress

- **WHEN** reads show an in-transit scan on Monday, again on Tuesday, then an out-for-delivery scan on Wednesday
- **THEN** in transit keeps Monday's scan date and out for delivery has Wednesday's

#### Scenario: One delivered read contains earlier scans

- **WHEN** the first read is delivered and its activity list includes an in-transit scan with a date
- **THEN** in transit stores that scan date

#### Scenario: Stage passed with no scan

- **WHEN** the first read is delivered and holds no out-for-delivery scan
- **THEN** out for delivery counts as reached with no date

#### Scenario: Failed read

- **WHEN** a tracking read fails
- **THEN** no stage date changes

### Requirement: A UPS problem is a warning, not a stage

When the latest scan is an exception or a return to shipper (`RS`), the shipment MUST keep its reached stages, MUST NOT move a stage forward, and MUST show a warning with the UPS description on the current stage. A later read that is neither MUST clear the warning.

#### Scenario: Exception in transit

- **WHEN** a shipment in transit gets an exception read
- **THEN** the current stage stays in transit and shows the warning

#### Scenario: Returned to shipper

- **WHEN** a shipment already in transit is read with type `RS`
- **THEN** the current stage stays in transit, the UPS description shows as a warning, no stage date moves forward, and no second shipped letter is sent

#### Scenario: Problem resolved

- **WHEN** the next read shows out for delivery
- **THEN** the warning is gone and out for delivery is reached

### Requirement: Store shows the delivery timeline

The plan history in the store MUST show, for each shipment that is not voided, the four stages in order, each reached stage with its date when known, the description of the latest UPS read under the current stage, and any warning. The current stage is the highest reached. The UPS tracking link MUST stay available. Texts MUST follow the site language.

#### Scenario: Shipment in transit

- **WHEN** a customer opens the plan history for a shipment in transit
- **THEN** label created and in transit are marked with dates, the last two stages are pending, and the tracking link is shown

#### Scenario: Back at the hub after out for delivery

- **WHEN** a read after out for delivery is an in-transit scan back at a hub
- **THEN** the current stage stays out for delivery and the latest UPS description is shown under it

#### Scenario: Voided label

- **WHEN** a label was voided
- **THEN** the store shows no timeline for it

### Requirement: Manual refresh follows the same rules

A tracking refresh started from the admin panel MUST record stages and send the shipped letter by the same rules as the scheduled refresh. A refresh and a tick at the same time MUST NOT send two letters.

#### Scenario: Operator refreshes a picked-up shipment

- **WHEN** an operator refreshes tracking and UPS shows the box in transit for the first time
- **THEN** the in transit date is stored and the customer receives the shipped letter once

#### Scenario: Refresh and tick together

- **WHEN** a refresh and a tick read the first in-transit scan at the same time
- **THEN** the customer receives one shipped letter
