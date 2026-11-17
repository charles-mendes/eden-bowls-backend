## MODIFIED Requirements

### Requirement: Status moves only forward

Only a delivery out for delivery MUST be able to become delivered, failed or canceled. Delivered stores a delivery instant, which defaults to now, MUST NOT be after now, and MUST NOT be before the minute of the out-for-delivery date. A delivery instant inside that minute but before the exact departure MUST be stored as the departure instant. Failed stores a reason. Delivered, failed and canceled are final: any later status change, including a repeat of the same one, MUST answer 409 `courier_delivery_final`. When two changes race, exactly one MUST succeed.

#### Scenario: Mark delivered

- **WHEN** an operator marks a delivery out for delivery as delivered with no date
- **THEN** its status is delivered and its delivered date is now

#### Scenario: Delivered date in the future

- **WHEN** the delivered date given is tomorrow
- **THEN** the API returns 422 and the status is unchanged

#### Scenario: Failure without a reason

- **WHEN** an operator marks a delivery as failed with no reason
- **THEN** the API returns 422 and the status is unchanged

#### Scenario: Change after delivered

- **WHEN** an operator tries to mark a delivered delivery as failed
- **THEN** the API returns 409 with code `courier_delivery_final`

#### Scenario: Two completions at once

- **WHEN** two operators mark the same delivery delivered and failed at the same time
- **THEN** one request succeeds, the other gets 409 `courier_delivery_final`, and the record holds only the winning status

#### Scenario: Repeated delivered

- **WHEN** an operator marks a delivered delivery delivered again
- **THEN** the API returns 409 and the delivered date is unchanged

#### Scenario: Delivered in the minute the box left

- **WHEN** the box left at 03:32:40 and the operator marks it delivered at 03:32
- **THEN** the status is delivered and the delivered date is 03:32:40

#### Scenario: Delivered before the minute the box left

- **WHEN** the box left at 03:32:40 and the delivered date given is 03:31
- **THEN** the API returns 422 and the status is unchanged
