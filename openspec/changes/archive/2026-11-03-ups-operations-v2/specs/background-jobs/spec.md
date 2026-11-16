# Spec Delta

## MODIFIED Requirements

### Requirement: In-transit UPS shipments refresh tracking

A scheduled tick MUST call UPS tracking for shipments that have a tracking number and are not delivered or voided. It MUST run at most every 30 minutes and MUST take at most 20 shipments per tick. One track call MUST stop at the minimum of 10 seconds and the configured UPS client timeout. When that client timeout is 5 seconds, the call MUST stop at 5 seconds. When the client timeout is above 10 seconds, the tick MUST still stop the call at 10 seconds. A track failure MUST leave the stored tracking as it was and MUST NOT void the shipment. A successful read MUST record the stages and MUST try the shipped letter when the shipment has reached in transit or later and the letter was not sent. A failed letter MUST NOT undo the stored tracking. A delivered shipment whose letter was not sent MUST have the letter tried again by later ticks without a UPS call, for at most 7 days after delivery. Each tick MUST log how many shipments it scanned, updated, failed, and mailed. The job MUST NOT buy labels or create shipments.

#### Scenario: Open shipment is polled

- **WHEN** a shipment has a tracking number and is not delivered or voided
- **THEN** a tick updates the stored tracking from UPS

#### Scenario: Delivered shipment is skipped

- **WHEN** a shipment is already delivered
- **THEN** the tick does not call UPS for it

#### Scenario: First pickup read

- **WHEN** a tick reads a shipment in transit for the first time
- **THEN** the tick stores the in transit date and sends the shipped letter for that shipment

#### Scenario: SMTP down at pickup

- **WHEN** the shipped letter cannot be sent during the tick
- **THEN** the tracking stays stored, the letter is not counted as sent, and the next tracking read of that shipment tries the letter again

#### Scenario: SMTP down when the first read is delivered

- **WHEN** the first read of a shipment is delivered and the shipped letter fails
- **THEN** the next tick tries the letter again without calling UPS, and stops trying 7 days after delivery
