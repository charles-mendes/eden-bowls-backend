# Spec Delta

## Purpose

Defines the delivery stages a UPS shipment reaches, the date each stage is first reached, and how the customer sees them in the store.

## ADDED Requirements

### Requirement: Stage dates are kept from the first time

A shipment MUST store the date it first reached each of four stages: label created, in transit, out for delivery, and delivered. Label created is the purchase time. A later read MUST NOT change a date already stored. A stage passed without a read MUST count as reached with no date.

#### Scenario: Normal progress

- **WHEN** tracking reads show in transit on Monday, again on Tuesday, then out for delivery on Wednesday
- **THEN** in transit keeps Monday's date and out for delivery has Wednesday's date

#### Scenario: Stage passed between reads

- **WHEN** the first read after the purchase already shows delivered
- **THEN** in transit and out for delivery count as reached with no date, and delivered has its date

#### Scenario: Failed read

- **WHEN** a tracking read fails
- **THEN** no stage date changes

### Requirement: A UPS problem is a warning, not a stage

When the latest tracking read is an exception, the shipment MUST keep its reached stages and MUST show a warning with the UPS description on the current stage. A later read that is not an exception MUST clear the warning.

#### Scenario: Exception in transit

- **WHEN** a shipment in transit gets an exception read
- **THEN** the current stage stays in transit and shows the warning

#### Scenario: Problem resolved

- **WHEN** the next read shows out for delivery
- **THEN** the warning is gone and out for delivery is reached

### Requirement: Store shows the delivery timeline

The plan history in the store MUST show, for each shipment that is not voided, the four stages in order, each reached stage with its date when known, and any warning on the current stage. The UPS tracking link MUST stay available. Texts MUST follow the site language.

#### Scenario: Shipment in transit

- **WHEN** a customer opens the plan history for a shipment in transit
- **THEN** label created and in transit are marked with dates, the last two stages are pending, and the tracking link is shown

#### Scenario: Voided label

- **WHEN** a label was voided
- **THEN** the store shows no timeline for it

### Requirement: Manual refresh follows the same rules

A tracking refresh started from the admin panel MUST record stage dates and send the shipped letter by the same rules as the scheduled refresh.

#### Scenario: Operator refreshes a picked-up shipment

- **WHEN** an operator refreshes tracking and UPS shows the box in transit for the first time
- **THEN** the in transit date is stored and the customer receives the shipped letter once
