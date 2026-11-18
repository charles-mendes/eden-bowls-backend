# Spec Delta

## ADDED Requirements

### Requirement: Day-5 Starter invite

The system MUST email each paid Starter one invite on Day 1 + 4 days, in the market's language, with the Starter's pets and a link to confirm the plan in the store. It MUST be sent at most once per Starter, also when Day 1 later changes from expected to confirmed. It MUST NOT be sent when the customer already has a plan confirmed from that Starter, or when the Starter was refunded or cancelled before Day 1. A Starter that reaches Day 1 + 4 later than planned, for example after a late delivery, MUST still get the invite on the day it qualifies.

#### Scenario: Delivered and not confirmed

- **WHEN** a Starter's Day 1 was 2026-12-03 and the customer has no plan on 2026-12-07
- **THEN** the customer receives one invite on 2026-12-07

#### Scenario: Customer confirmed on Day 2

- **WHEN** the customer checked out a plan from the Starter before Day 1 + 4
- **THEN** no invite is sent

#### Scenario: Delivery confirmed after the invite

- **WHEN** the invite was sent from the expected Day 1 and the courier marks the delivery the next day
- **THEN** no second invite is sent
