# Spec Delta

## MODIFIED Requirements

### Requirement: Renewal notice before a new contract

The system MUST email a renewal notice when a subscription is `active` or `trialing`, renewal is on, it is not set to cancel at period end, its period ends within the market's notice window, and the next charge starts a new contract, counting only deliveries of the current contract. The window MUST run from now to now plus the configured days, so a period end in the past never qualifies.

#### Scenario: One-month plan

- **WHEN** a one-month plan with renewal on has its period ending in 7 days and the market window is 7 days
- **THEN** the customer receives one renewal notice

#### Scenario: Last paid delivery of a three-month contract

- **WHEN** a three-month plan with renewal on has 3 charged deliveries and its period ends inside the window
- **THEN** the customer receives one renewal notice

#### Scenario: Charge inside a contract

- **WHEN** a three-month plan with renewal on has 1 charged delivery and its period ends inside the window
- **THEN** no renewal notice is sent

#### Scenario: One-month plan without a stored count

- **WHEN** a one-month plan has no stored charged-delivery count and its period ends inside the window
- **THEN** the customer receives one renewal notice

#### Scenario: One-month plan with nothing charged

- **WHEN** a one-month plan has a stored count of 0
- **THEN** no renewal notice is sent, because there is no contract to renew yet

#### Scenario: Period end already passed

- **WHEN** the job was stopped and a period end is earlier than now
- **THEN** no notice is sent and `plan_notice` is null

#### Scenario: Charged deliveries unknown on a longer term

- **WHEN** a three-month plan has no stored charged-delivery count
- **THEN** no renewal notice is sent and the run counts it as skipped

#### Scenario: Subscription not in good standing

- **WHEN** the subscription is `past_due`, `paused`, or `canceled`
- **THEN** no renewal notice is sent

#### Scenario: Term change before the last delivery

- **WHEN** a plan with 3 charged deliveries changed to three months and has 1 delivery charged since
- **THEN** no renewal notice is sent

#### Scenario: First charge after a term change

- **WHEN** a plan changed term and no delivery was charged since
- **THEN** no renewal notice is sent
