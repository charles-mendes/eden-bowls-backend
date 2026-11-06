# Spec Delta

## MODIFIED Requirements

### Requirement: Shipment letter stays on US tracking
The system SHALL email the customer the existing shipped letter when UPS tracking first shows a US shipment in transit, out for delivery, or delivered. Buying the label MUST NOT send the letter. The letter MUST be sent at most once per shipment. The recipient MUST be the subscription's customer email, the same one the order letter uses. The letter MUST include the tracking number and a UPS tracking link. The system MUST NOT send that letter for a Brazil production-status change, because that queue has no shipped event and no tracking number.

#### Scenario: UPS label created
- **WHEN** a US shipment is stored with a tracking number
- **THEN** no shipped letter is sent yet

#### Scenario: First read in transit
- **WHEN** a tracking read first shows the shipment in transit and the subscription has a customer email
- **THEN** the customer receives one shipped letter for that shipment

#### Scenario: First read already delivered
- **WHEN** the first tracking read after the purchase shows delivered
- **THEN** the customer receives one shipped letter, and no other letter for that shipment

#### Scenario: Later reads
- **WHEN** a shipment whose letter was sent gets more tracking reads
- **THEN** no second shipped letter is sent

#### Scenario: Label bought before this rule
- **WHEN** a shipment's letter was sent at purchase and tracking later shows it in transit
- **THEN** SMTP is not called

#### Scenario: Label voided before pickup
- **WHEN** a label is voided before any read shows it moving
- **THEN** no shipped letter is sent

#### Scenario: No customer email
- **WHEN** the first moving read is stored and the subscription has no customer email
- **THEN** no letter is sent and the skip is logged with the shipment id and template

#### Scenario: SMTP fails on the first moving read
- **WHEN** the first in-transit read is stored and the shipped letter's SMTP send fails
- **THEN** the tracking stays stored and a later tracking read sends that one letter

#### Scenario: Brazil production advances
- **WHEN** an operator moves a Brazil subscription through the production queue
- **THEN** no shipped letter is sent
