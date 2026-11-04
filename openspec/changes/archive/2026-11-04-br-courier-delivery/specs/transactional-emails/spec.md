# Spec Delta

## ADDED Requirements

### Requirement: Courier out-for-delivery letter

The system SHALL email the customer an out-for-delivery letter when a courier delivery is registered. The letter MUST name the pet and MUST include the tracking link when the delivery has one. The greeting MUST follow the existing letters and MUST NOT use the recipient name. It MUST be claimed once per delivery record, so a new attempt after a failure sends a new letter. Editing a delivery MUST NOT send a letter. A send failure MUST NOT undo the dispatch and MUST be logged. The letter MUST NOT be resent automatically, because the mail rules allow no background job.

#### Scenario: Dispatch with a link

- **WHEN** an operator registers a courier delivery with a tracking link
- **THEN** the customer receives the out-for-delivery letter in pt-BR with the link

#### Scenario: Second attempt

- **WHEN** a delivery failed and the invoice is dispatched again
- **THEN** the customer receives a second out-for-delivery letter for the new attempt

#### Scenario: SMTP down

- **WHEN** the letter fails to send
- **THEN** the delivery stays out for delivery, the failure is logged, and no later action resends it

### Requirement: Courier delivered letter

The system SHALL email the customer a delivered letter when a courier delivery is marked delivered. It MUST be claimed once per delivery record. Marking a delivery failed or canceled MUST NOT send a letter. A send failure MUST NOT undo the status, MUST be logged, and MUST NOT be resent automatically.

#### Scenario: Delivered

- **WHEN** an operator marks a courier delivery delivered
- **THEN** the customer receives the delivered letter once

#### Scenario: Failed

- **WHEN** an operator marks a courier delivery failed
- **THEN** no letter is sent
